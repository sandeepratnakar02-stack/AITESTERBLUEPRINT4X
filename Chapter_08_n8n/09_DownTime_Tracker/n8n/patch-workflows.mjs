/**
 * One-time patch for the hand-authored workflows in this folder.
 *
 *   node patch-workflows.mjs
 *
 * Fixes the defects listed in `README.md` § "Defects found in that export".
 * Originals are copied to `before-patch/` first. Every edit asserts that its
 * anchor matches **exactly once**, so re-running against an already-patched file
 * fails loudly instead of corrupting it.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = join(here, "before-patch");

const MONITOR = "01_VWO_Downtime_Monitor.json";
const API = "02_VWO_Downtime_Tracker_API.json";

const changes = [];

function load(file) {
  return JSON.parse(readFileSync(join(here, file), "utf8"));
}

function save(file, workflow) {
  writeFileSync(join(here, file), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
}

function node(workflow, name) {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`Node not found: ${name}`);
  return found;
}

/** Replaces `oldText` inside a node's jsCode, asserting a single occurrence. */
function patchCode(workflow, nodeName, oldText, newText, note) {
  const target = node(workflow, nodeName);
  const code = target.parameters.jsCode;
  if (typeof code !== "string") throw new Error(`${nodeName} has no jsCode`);

  const occurrences = code.split(oldText).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Anchor matched ${occurrences} times (expected 1) in "${nodeName}":\n${oldText.slice(0, 160)}`,
    );
  }

  target.parameters.jsCode = code.replace(oldText, newText);
  changes.push(`${nodeName.split(" ")[0]}: ${note}`);
}

function patchParam(workflow, nodeName, apply, note) {
  apply(node(workflow, nodeName).parameters);
  changes.push(`${nodeName.split(" ")[0]}: ${note}`);
}

/* -------------------------------------------------------------------------- */
/*  Back up                                                                    */
/* -------------------------------------------------------------------------- */

mkdirSync(BACKUP_DIR, { recursive: true });
for (const file of [MONITOR, API]) {
  copyFileSync(join(here, file), join(BACKUP_DIR, file));
}

/* -------------------------------------------------------------------------- */
/*  01 — monitor                                                               */
/* -------------------------------------------------------------------------- */

const monitor = load(MONITOR);

/* 1. Schedule had {"field":"minutes"} with no interval → no usable period. */
patchParam(
  monitor,
  "01 - Scheduled Monitor",
  (parameters) => {
    parameters.rule = { interval: [{ field: "minutes", minutesInterval: 5 }] };
  },
  "schedule interval set to every 5 minutes",
);

/* 2. Runtime settings: default + read a second retry delay. */
patchCode(
  monitor,
  "03 - Build Service Checks",
  `  retryDelayMs: 5000,\n  application: 'VWO'`,
  `  retryDelayMs: 5000,\n  retryDelayMs2: 30000,\n  application: 'VWO'`,
  "added retryDelayMs2 default (30 s)",
);

patchCode(
  monitor,
  "03 - Build Service Checks",
  `    case 'retryDelayMs':\n      settings.retryDelayMs =\n        Number(rawValue) || 5000;\n      break;`,
  `    case 'retryDelayMs':\n      settings.retryDelayMs =\n        Number(rawValue) || 5000;\n      break;\n\n    case 'retryDelayMs2':\n      settings.retryDelayMs2 =\n        Number(rawValue) || 30000;\n      break;`,
  "reads retryDelayMs2 from the Settings sheet",
);

patchCode(
  monitor,
  "03 - Build Service Checks",
  `    retryDelayMs:\n      settings.retryDelayMs,\n\n    configuredRetryCount,`,
  `    retryDelayMs:\n      settings.retryDelayMs,\n\n    retryDelayMs2:\n      settings.retryDelayMs2,\n\n    configuredRetryCount,`,
  "passes retryDelayMs2 to the checks",
);

/* 3. Second wait node reused the first delay, so 20 s and 30 s were identical. */
patchParam(
  monitor,
  "09 - Wait 30 Seconds",
  (parameters) => {
    parameters.amount = "={{ Number($json.retryDelayMs2 || 30000) / 1000 }}";
  },
  "final wait now uses retryDelayMs2",
);

/* 4. Missing/renamed Settings tab failed the whole run. */
patchParam(
  monitor,
  "02B - Read Runtime Settings",
  (parameters) => {
    parameters.options = parameters.options ?? {};
  },
  "tolerates a missing Settings tab",
);

/* 5. Only failures were appended to Health_Check_History. */
patchCode(
  monitor,
  "11A - Prepare Sheet Row",
  `const status =\n  x['Health Status'] ||\n  x.healthStatus;\n\nif (\n  status !== 'DOWN' &&\n  status !== 'FUNCTIONAL_FAILURE'\n) {\n  return;\n}\n`,
  `const status =\n  x['Health Status'] ||\n  x.healthStatus ||\n  'UNKNOWN';\n\n// Every check is appended, not just failures. Previously this node returned\n// early for UP/DEGRADED rows, so Health_Check_History held only failures,\n// latency charts had no healthy series and daily availability read ~0%.\nconst pad = (n) => String(n).padStart(2, '0');\n\nfunction toSheetTimestamp(value) {\n  if (!value) {\n    return '';\n  }\n\n  const d = new Date(value);\n\n  if (Number.isNaN(d.getTime())) {\n    return String(value);\n  }\n\n  return (\n    d.getFullYear() +\n    '-' +\n    pad(d.getMonth() + 1) +\n    '-' +\n    pad(d.getDate()) +\n    ' ' +\n    pad(d.getHours()) +\n    ':' +\n    pad(d.getMinutes()) +\n    ':' +\n    pad(d.getSeconds())\n  );\n}\n`,
  "logs every check instead of failures only",
);

patchCode(
  monitor,
  "11A - Prepare Sheet Row",
  `return {\n  json: {\n    'Application': x['Application'] || x.application || '',`,
  `return {\n  json: {\n    'Timestamp':\n      x['Timestamp'] || toSheetTimestamp(x.checkedAt),\n\n    'Application': x['Application'] || x.application || '',`,
  "writes the Timestamp column (was missing entirely)",
);

/* 6. Daily bucket compared a local timestamp with a UTC date. */
patchCode(
  monitor,
  "22 - Aggregate Daily Availability",
  `const today = new Date().toISOString().slice(0, 10);`,
  `// History rows are stamped in server-local time, so the day key must be too:\n// a UTC key excludes rows written either side of midnight on a UTC+5:30 host.\nconst now = new Date();\nconst pad2 = (n) => String(n).padStart(2, '0');\nconst today =\n  now.getFullYear() +\n  '-' +\n  pad2(now.getMonth() + 1) +\n  '-' +\n  pad2(now.getDate());`,
  "daily bucket uses the same timezone as the history rows",
);

patchParam(
  monitor,
  "21 - Read Health History",
  () => {},
  "emits output when the history sheet is empty",
);

/* alwaysOutputData / onError are node-level, not parameters. */
node(monitor, "21 - Read Health History").alwaysOutputData = true;
node(monitor, "02B - Read Runtime Settings").onError = "continueRegularOutput";
node(monitor, "02B - Read Runtime Settings").alwaysOutputData = true;

save(MONITOR, monitor);

/* -------------------------------------------------------------------------- */
/*  02 — API                                                                   */
/* -------------------------------------------------------------------------- */

const api = load(API);

/* 7. mapStatus never returned HEALTHY / never mapped DEGRADED. */
patchCode(
  api,
  "API 01b - Build Services + Summary",
  `  if (\n    healthStatus === 'UP' &&\n    functionalValidation === 'PASS'\n  ) {\n    return 'HEALTHY';\n  }\n\n  if (healthStatus === 'SLOW') {\n    return 'SLOW';\n  }\n\n  if (\n    healthStatus === 'DOWN' ||\n    healthStatus === 'FAILED'\n  ) {\n    return 'DOWN';\n  }\n\n  if (functionalValidation === 'FAIL') {\n    return 'FUNCTIONAL_FAILURE';\n  }\n\n  return 'UNKNOWN';`,
  `  // A functional assertion failure wins even when the HTTP call returned 200.\n  if (functionalValidation === 'FAIL') {\n    return 'FUNCTIONAL_FAILURE';\n  }\n\n  if (healthStatus === 'DOWN' || healthStatus === 'FAILED') {\n    return 'DOWN';\n  }\n\n  // The monitor emits DEGRADED (older exports emitted SLOW).\n  if (healthStatus === 'DEGRADED' || healthStatus === 'SLOW') {\n    return 'SLOW';\n  }\n\n  // UP means the HTTP check passed. Requiring functionalValidation === 'PASS'\n  // here left every service without an expectedText (NOT_APPLICABLE) UNKNOWN.\n  if (healthStatus === 'UP' || healthStatus === 'HEALTHY') {\n    return 'HEALTHY';\n  }\n\n  return 'UNKNOWN';`,
  "mapStatus now returns HEALTHY for UP and maps DEGRADED to SLOW",
);

/* 8. uptimePct divided services; overallStatus escalated on any failure. */
patchCode(
  api,
  "API 01b - Build Services + Summary",
  `let overallStatus = 'UNKNOWN';\n\nif (services.length > 0) {\n  if (failedServices > 0) {\n    overallStatus = 'DOWN';\n  } else if (slowServices > 0) {\n    overallStatus = 'DEGRADED';\n  } else {\n    overallStatus = 'HEALTHY';\n  }\n}\n\nconst uptimePct =\n  services.length > 0\n    ? Number(\n        ((healthyServices / services.length) * 100).toFixed(2)\n      )\n    : 0;`,
  `// Only a *critical* failure should take the whole application DOWN; a single\n// non-critical service failing is a degradation, not an outage.\nconst criticalFailures = latestRows.filter((row) => {\n  const state = mapStatus(row);\n\n  return (\n    (state === 'DOWN' || state === 'FUNCTIONAL_FAILURE') &&\n    (row['Critical'] === true ||\n      String(row['Critical']).toLowerCase() === 'true')\n  );\n}).length;\n\nlet overallStatus = 'UNKNOWN';\n\nif (services.length > 0) {\n  if (criticalFailures > 0) {\n    overallStatus = 'DOWN';\n  } else if (failedServices > 0 || slowServices > 0) {\n    overallStatus = 'DEGRADED';\n  } else {\n    overallStatus = 'HEALTHY';\n  }\n}\n\n// Availability across the whole window. Dividing the current snapshot by the\n// service count made one failure look like 80% uptime.\nconst totalChecks = environmentRows.length;\n\nconst unavailableChecks = environmentRows.filter((row) => {\n  const state = mapStatus(row);\n\n  return state === 'DOWN' || state === 'FUNCTIONAL_FAILURE';\n}).length;\n\nconst uptimePct =\n  totalChecks > 0\n    ? Number(\n        (((totalChecks - unavailableChecks) / totalChecks) * 100).toFixed(2)\n      )\n    : 0;`,
  "uptimePct computed over the window; DOWN reserved for critical failures",
);

/* 9. Retry timeline events carried no timestamp. */
patchCode(
  api,
  "API 06b - Map Incidents",
  `const incidents = filteredRows.map(row => {`,
  `// Retry timeline entries previously had no timestamp; derive them from the\n// incident start plus the configured retry delays.\nfunction shiftSheetTime(value, seconds) {\n  const match = String(value || '').match(\n    /^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{1,2}):(\\d{2}):(\\d{2})/\n  );\n\n  if (!match) {\n    return '';\n  }\n\n  const base = new Date(\n    Number(match[1]),\n    Number(match[2]) - 1,\n    Number(match[3]),\n    Number(match[4]),\n    Number(match[5]),\n    Number(match[6])\n  );\n\n  base.setSeconds(base.getSeconds() + seconds);\n\n  const pad = (n) => String(n).padStart(2, '0');\n\n  return (\n    base.getFullYear() +\n    '-' +\n    pad(base.getMonth() + 1) +\n    '-' +\n    pad(base.getDate()) +\n    ' ' +\n    pad(base.getHours()) +\n    ':' +\n    pad(base.getMinutes()) +\n    ':' +\n    pad(base.getSeconds())\n  );\n}\n\nconst incidents = filteredRows.map(row => {`,
  "added a timestamp helper for derived timeline events",
);

patchCode(
  api,
  "API 06b - Map Incidents",
  `  if (retryCount >= 1) {\n    timeline.push({\n      type: 'RETRY',\n      attempt: 2,\n      delaySeconds: 20,\n      message: 'Retry attempt after 20 seconds'\n    });\n  }\n\n  if (retryCount >= 2) {\n    timeline.push({\n      type: 'RETRY',\n      attempt: 3,\n      delaySeconds: 30,\n      message: 'Final retry attempt after 30 seconds'\n    });\n  }`,
  `  if (retryCount >= 1) {\n    timeline.push({\n      type: 'RETRY',\n      attempt: 2,\n      delaySeconds: 20,\n      timestamp: shiftSheetTime(row['Downtime Start'], 22),\n      message: 'Retry attempt after 20 seconds'\n    });\n  }\n\n  if (retryCount >= 2) {\n    timeline.push({\n      type: 'RETRY',\n      attempt: 3,\n      delaySeconds: 30,\n      timestamp: shiftSheetTime(row['Downtime Start'], 54),\n      message: 'Final retry attempt after 30 seconds'\n    });\n  }`,
  "retry timeline events now carry timestamps",
);

/* 10. Settings keys differed between the monitor and this API. */
patchCode(
  api,
  "API 09b - Build Settings",
  `return [\n  {\n    json: {\n      settings\n    }\n  }\n];`,
  `// The monitor workflow stores the retry ladder as retryCount / retryDelayMs\n// (+ retryDelayMs2). Mirror those so GET /settings reflects what is monitored.\nconst flat = {};\n\nfor (const row of rows) {\n  const flatKey = String(row['Key'] || '').trim();\n\n  if (flatKey) {\n    flat[flatKey] = row['Value'];\n  }\n}\n\nif (flat.retryCount !== undefined && flat.retryAttempts === undefined) {\n  settings.retryAttempts = (Number(flat.retryCount) || 0) + 1;\n}\n\nconst delayLadder = [flat.retryDelayMs, flat.retryDelayMs2]\n  .map((value) => Number(value))\n  .filter((value) => Number.isFinite(value) && value > 0);\n\nif (delayLadder.length > 0) {\n  settings.retryDelaysSeconds = delayLadder.map((ms) =>\n    Math.round(ms / 1000)\n  );\n}\n\nreturn [\n  {\n    json: {\n      settings\n    }\n  }\n];`,
  "GET /settings understands the monitor's retryCount / retryDelayMs keys",
);

patchCode(
  api,
  "API 10a - Normalise Settings Rows",
  `const allowedSettings = [\n  'environment',\n  'responseTimeThresholdMs',\n  'retryCount',\n  'retryDelayMs',\n  'application',\n];`,
  `const allowedSettings = [\n  'environment',\n  'application',\n  'responseTimeThresholdMs',\n  'retryCount',\n  'retryDelayMs',\n  'retryDelayMs2',\n  'retryAttempts',\n  'retryDelaysSeconds',\n  'checkIntervalMinutes',\n];`,
  "settings write accepts both key spellings",
);

patchCode(
  api,
  "API 10a - Normalise Settings Rows",
  `    rows.push({\n      json: {\n        setting: key,\n        value: body[key],\n      },\n    });`,
  `    const rawValue = body[key];\n\n    rows.push({\n      json: {\n        setting: key,\n        value: Array.isArray(rawValue)\n          ? rawValue.join(',')\n          : rawValue,\n      },\n    });`,
  "array settings are stored as comma-separated values",
);

save(API, api);

/* -------------------------------------------------------------------------- */
/*  Validate + report                                                          */
/* -------------------------------------------------------------------------- */

for (const [file, workflow] of [
  [MONITOR, monitor],
  [API, api],
]) {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [from, value] of Object.entries(workflow.connections)) {
    if (!names.has(from)) throw new Error(`${file}: connection source missing: ${from}`);
    for (const targets of value.main ?? []) {
      for (const target of targets) {
        if (!names.has(target.node)) throw new Error(`${file}: target missing: ${target.node}`);
      }
    }
  }
}

console.log(`Backed up originals -> n8n/before-patch/\n`);
console.log(`Applied ${changes.length} changes:`);
for (const change of changes) console.log(`  • ${change}`);
console.log(`\nMonitor nodes: ${monitor.nodes.length} | API nodes: ${api.nodes.length}`);
console.log("Both files re-parsed and all connections validated.");
