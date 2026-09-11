/**
 * Executes the patched Code-node bodies from both workflows against sample
 * Google Sheets rows and asserts the behaviour, so the fixes are verified
 * without round-tripping through n8n.
 *
 *   node verify-workflow-logic.mjs
 *
 * Exits non-zero on the first failed assertion.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadNode(file, nodeName) {
  const workflow = JSON.parse(readFileSync(join(here, file), "utf8"));
  const node = workflow.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`Node not found: ${nodeName} in ${file}`);
  return node.parameters.jsCode;
}

/** Minimal n8n runtime shim. */
async function runCode(code, { items = [], nodeRefs = {}, executionId = "9999" } = {}) {
  const toItems = (list) => list.map((json) => ({ json }));

  const $input = {
    all: () => toItems(items),
    first: () => (items.length ? { json: items[0] } : undefined),
  };

  const $ = (name) => {
    if (!(name in nodeRefs)) throw new Error(`Missing node reference: ${name}`);
    const json = nodeRefs[name];
    return { first: () => ({ json }), item: { json }, all: () => toItems([json]) };
  };

  const body = new Function(
    "helpers",
    "$json",
    "$input",
    "$execution",
    "$",
    "$getWorkflowStaticData",
    // The trailing `()` matters: the wrapper must be invoked, not returned.
    `return (async () => { ${code} })();`,
  );

  const result = await body({}, items[0], $input, { id: executionId }, $, () => ({}));
  const output = Array.isArray(result) ? result.map((entry) => entry.json) : (result?.json ?? result);

  // Most of these nodes emit a single row; unwrap it so assertions can read
  // fields directly. Multi-row nodes stay as an array.
  return Array.isArray(output) && output.length === 1 ? output[0] : output;
}

const checks = [];

function check(label, condition, detail) {
  checks.push({ label, passed: Boolean(condition), detail });
  if (!condition) {
    console.error(`✗ ${label}`);
    if (detail !== undefined) console.error(`   got: ${JSON.stringify(detail)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const now = new Date();

/* -------------------------------------------------------------------------- */
/*  01 — 11A must log every check and carry a Timestamp                        */
/* -------------------------------------------------------------------------- */

const prepareRow = loadNode("01_VWO_Downtime_Monitor.json", "11A - Prepare Sheet Row");

const healthyRow = {
  Timestamp: localStamp(new Date(now.getTime() - 60_000)),
  Application: "VWO",
  Environment: "QA",
  "Service Name": "VWO Main Application",
  "Check Type": "HTTP",
  Endpoint: "https://app.vwo.com/",
  "HTTP Status": 200,
  "Response Time Ms": 724,
  "Response Time Threshold Ms": 3000,
  "Health Status": "UP",
  "Functional Validation": "NOT_APPLICABLE",
  "Retry Count": 0,
  "Error Message": "",
  "Response Snippet": "",
  "Workflow Execution ID": "9001",
  Critical: true,
  _monitor: { huge: "internal object that must not reach the sheet" },
};

const healthyPrepared = await runCode(prepareRow, { items: [healthyRow] });
check(
  "monitor/11A: a healthy (UP) check is no longer dropped",
  healthyPrepared && healthyPrepared["Health Status"] === "UP",
  healthyPrepared,
);
check(
  "monitor/11A: Timestamp column is written",
  healthyPrepared?.Timestamp === healthyRow.Timestamp,
  healthyPrepared?.Timestamp,
);
check(
  "monitor/11A: internal _monitor blob is not written to the sheet",
  healthyPrepared && !("_monitor" in healthyPrepared),
  Object.keys(healthyPrepared ?? {}),
);

const degradedPrepared = await runCode(prepareRow, {
  items: [{ ...healthyRow, "Health Status": "DEGRADED", "Response Time Ms": 3400 }],
});
check(
  "monitor/11A: a DEGRADED check is also logged",
  degradedPrepared?.["Health Status"] === "DEGRADED",
  degradedPrepared,
);

/* -------------------------------------------------------------------------- */
/*  01 — 22 availability must use the same day key as the rows                 */
/* -------------------------------------------------------------------------- */

const aggregate = loadNode("01_VWO_Downtime_Monitor.json", "22 - Aggregate Daily Availability");

const todayRows = [
  { Timestamp: localStamp(now), "Health Status": "UP" },
  { Timestamp: localStamp(now), "Health Status": "UP" },
  { Timestamp: localStamp(now), "Health Status": "UP" },
  { Timestamp: localStamp(now), "Health Status": "DOWN" },
];

const aggregateResult = await runCode(aggregate, { items: todayRows });
check(
  "monitor/22: today's checks are counted (local-date key)",
  aggregateResult?.["Total Checks"] === 4,
  aggregateResult,
);
check(
  "monitor/22: availability is 75% for 3/4 healthy checks",
  aggregateResult?.["Availability Percentage"] === 75,
  aggregateResult?.["Availability Percentage"],
);
check(
  "monitor/22: row targets the OVERALL / ALL_SERVICES series",
  aggregateResult?.Environment === "OVERALL" && aggregateResult?.["Service Name"] === "ALL_SERVICES",
  aggregateResult,
);

/* -------------------------------------------------------------------------- */
/*  02 — API 01b status mapping + summary                                      */
/* -------------------------------------------------------------------------- */

const buildSummary = loadNode("02_VWO_Downtime_Tracker_API.json", "API 01b - Build Services + Summary");

const historyRow = (service, status, httpStatus, responseTimeMs, critical, minutesAgo) => ({
  Timestamp: localStamp(new Date(now.getTime() - minutesAgo * 60_000)),
  Application: "VWO",
  Environment: "QA",
  "Service Name": service,
  "Check Type": "HTTP",
  Endpoint: "https://app.vwo.com/",
  "HTTP Status": httpStatus,
  "Response Time Ms": responseTimeMs,
  "Response Time Threshold Ms": 3000,
  "Health Status": status,
  "Functional Validation": "NOT_APPLICABLE",
  "Retry Count": 0,
  "Error Message": status === "DOWN" ? "HTTP 500" : "",
  "Workflow Execution ID": "9002",
  Critical: critical,
});

const summaryRows = [
  // older window
  historyRow("VWO Main Application", "UP", 200, 700, true, 90),
  historyRow("VWO Login", "UP", 200, 900, true, 90),
  historyRow("VWO Editor", "DOWN", 500, 5800, false, 20),
  // latest snapshot
  historyRow("VWO Main Application", "UP", 200, 724, true, 1),
  historyRow("VWO Login", "UP", 200, 910, true, 2),
  historyRow("VWO Campaign Dashboard", "DEGRADED", 200, 3400, false, 3),
  historyRow("VWO Editor", "DOWN", 500, 5800, false, 4),
];

const summaryResult = await runCode(buildSummary, {
  items: summaryRows,
  nodeRefs: { "API 01 - GET health-status": { query: { environment: "QA" } } },
});

const byName = Object.fromEntries((summaryResult?.services ?? []).map((s) => [s.name, s]));

check(
  "api/01b: UP now maps to HEALTHY (was UNKNOWN)",
  byName["VWO Main Application"]?.status === "HEALTHY",
  byName["VWO Main Application"]?.status,
);
check(
  "api/01b: DEGRADED now maps to SLOW (was UNKNOWN)",
  byName["VWO Campaign Dashboard"]?.status === "SLOW",
  byName["VWO Campaign Dashboard"]?.status,
);
check("api/01b: DOWN still maps to DOWN", byName["VWO Editor"]?.status === "DOWN", byName["VWO Editor"]?.status);
check(
  "api/01b: healthyServices is populated",
  summaryResult?.summary?.healthyServices === 2,
  summaryResult?.summary?.healthyServices,
);
check(
  "api/01b: only the latest row per service is used",
  summaryResult?.services?.length === 4,
  summaryResult?.services?.length,
);
check(
  "api/01b: uptimePct is window-based, not service-ratio",
  summaryResult?.summary?.uptimePct === 71.43,
  summaryResult?.summary?.uptimePct,
);
check(
  "api/01b: a non-critical failure degrades instead of going DOWN",
  summaryResult?.summary?.overallStatus === "DEGRADED",
  summaryResult?.summary?.overallStatus,
);

/* -------------------------------------------------------------------------- */
/*  02 — incident timeline carries timestamps                                  */
/* -------------------------------------------------------------------------- */

const mapIncidents = loadNode("02_VWO_Downtime_Tracker_API.json", "API 06b - Map Incidents");

const incidentResult = await runCode(mapIncidents, {
  items: [
    {
      "Incident ID": "INC-20260911093604-vwo-editor",
      Application: "VWO",
      Environment: "QA",
      "Service Name": "VWO Editor",
      Endpoint: "https://app.vwo.com/",
      Status: "OPEN",
      Severity: "SEV-3",
      "Downtime Start": localStamp(new Date(now.getTime() - 6 * 60_000)),
      "Recovery Time": "",
      "Downtime Seconds": 0,
      "Retry Count": 2,
      "HTTP Status": 500,
      "Response Time Ms": 5800,
      "Failure Reason": "HTTP 500",
      "HTTP Response": "500 Internal Server Error",
      "Workflow Execution ID": "9003",
    },
  ],
  nodeRefs: { "API 06 - GET incidents": { query: { environment: "QA" } } },
});

const retryEvents = (incidentResult?.incidents?.[0]?.timeline ?? []).filter((e) => e.type === "RETRY");
check("api/06b: two retry events are emitted", retryEvents.length === 2, retryEvents.length);
check(
  "api/06b: retry events now carry a timestamp",
  retryEvents.every((event) => Boolean(event.timestamp)),
  retryEvents.map((event) => event.timestamp),
);

/* -------------------------------------------------------------------------- */
/*  02 — settings read/write use one key set                                   */
/* -------------------------------------------------------------------------- */

const buildSettings = loadNode("02_VWO_Downtime_Tracker_API.json", "API 09b - Build Settings");

const settingsResult = await runCode(buildSettings, {
  items: [
    { Key: "responseTimeThresholdMs", Value: 3000 },
    { Key: "retryCount", Value: 2 },
    { Key: "retryDelayMs", Value: 20000 },
    { Key: "retryDelayMs2", Value: 30000 },
  ],
});

check(
  "api/09b: retryCount is translated to retryAttempts",
  settingsResult?.settings?.retryAttempts === 3,
  settingsResult?.settings?.retryAttempts,
);
check(
  "api/09b: the retry delay ladder is rebuilt from retryDelayMs/retryDelayMs2",
  JSON.stringify(settingsResult?.settings?.retryDelaysSeconds) === "[20,30]",
  settingsResult?.settings?.retryDelaysSeconds,
);

const normaliseSettings = loadNode("02_VWO_Downtime_Tracker_API.json", "API 10a - Normalise Settings Rows");

const writeResult = await runCode(normaliseSettings, {
  // This node reads the webhook item from `$input.first()`, not from `$()`.
  items: [
    {
      body: {
        responseTimeThresholdMs: 2500,
        retryAttempts: 3,
        retryDelaysSeconds: [20, 30],
        checkIntervalMinutes: 5,
      },
    },
  ],
});

const writtenKeys = (Array.isArray(writeResult) ? writeResult : []).map((row) => row.setting);
check(
  "api/10a: dashboard settings are persisted (not silently dropped)",
  writtenKeys.includes("retryAttempts") &&
    writtenKeys.includes("retryDelaysSeconds") &&
    writtenKeys.includes("checkIntervalMinutes"),
  writtenKeys,
);
const delayValue = (Array.isArray(writeResult) ? writeResult : []).find(
  (row) => row.setting === "retryDelaysSeconds",
)?.value;
check("api/10a: array settings are stored comma-separated", delayValue === "20,30", delayValue);

/* -------------------------------------------------------------------------- */

const failed = checks.filter((entry) => !entry.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length > 0 ? 1 : 0;
