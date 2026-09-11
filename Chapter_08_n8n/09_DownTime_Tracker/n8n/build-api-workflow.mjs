/**
 * Generates `09_DownTime_Tracker.API.json`.
 *
 * Run:  node build-api-workflow.mjs
 *
 * The monitoring workflow (`09_DownTime_Tracker.json`) only *writes* to Google
 * Sheets (schedule trigger, no HTTP surface). This second workflow is the read
 * API the dashboard consumes: one webhook per endpoint, backed by the very same
 * sheets, with mappers that translate the sheet schema into the JSON contract in
 * `../src/types/index.ts`.
 *
 * Keeping the mappers here (instead of hand-editing a 100 KB JSON) means the
 * mapping stays reviewable and the workflow can be regenerated safely.
 *
 * Sheet schemas were taken from the monitoring workflow itself:
 *   Health_Check_History  <- node "18a - Build Health History Rows"
 *   Downtime_Incidents    <- nodes "16c - Keep Only New Incidents" / "20b - Build Resolution Row"
 *   Daily_Availability    <- node "24 - Aggregate Overall VWO Health"
 */

import { writeFileSync } from "node:fs";

const SPREADSHEET_ID = "REPLACE_WITH_SPREADSHEET_ID";
const MONITOR_WORKFLOW_ID = "REPLACE_WITH_MONITOR_WORKFLOW_ID";

/* -------------------------------------------------------------------------- */
/*  Shared helpers injected into every mapper Code node                        */
/* -------------------------------------------------------------------------- */

const PRELUDE = [
  "const S = (v) => (v === undefined || v === null) ? '' : String(v).trim();",
  "const NUM = (v) => { const n = Number(String(v === undefined || v === null ? '' : v).replace(/[^0-9.\\-]/g, '')); return Number.isFinite(n) ? n : 0; };",
  "const pick = (row, keys, fallback) => { for (const k of keys) { const v = row[k]; if (v !== undefined && v !== null && String(v) !== '') return v; } return fallback === undefined ? '' : fallback; };",
  "const STATUS_MAP = { UP: 'HEALTHY', HEALTHY: 'HEALTHY', DEGRADED: 'SLOW', SLOW: 'SLOW', DOWN: 'DOWN', FUNCTIONAL_FAILURE: 'FUNCTIONAL_FAILURE', RETRYING: 'RETRYING', UNKNOWN: 'UNKNOWN' };",
  "const normStatus = (v) => STATUS_MAP[S(v).toUpperCase()] || 'UNKNOWN';",
  "const isoTs = (v) => { const s = S(v); if (!s) return null; const m = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})/); if (m) return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+05:30').toISOString(); const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); };",
  "const slug = (v) => 'svc-' + S(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
  "const env = (row) => S(pick(row, ['Environment', 'environment'], 'QA')) || 'QA';",
  "const svcName = (row) => S(pick(row, ['Service Name', 'serviceName']));",
  "const rows = () => $input.all().map((it) => it.json || {});",
  "const MAX_ROWS = 1000;",
].join("\n");

/** Reads the query string of the branch's own Webhook node. */
const queryOf = (webhookNodeName) =>
  [
    "let query = {};",
    "try { query = ($('" + webhookNodeName + "').first().json || {}).query || {}; } catch (e) { query = {}; }",
    "const envFilter = S(query.environment || query.env || '');",
    "const idFilter = S(query.id || '');",
  ].join("\n");

/** Filters sheet rows by ?environment= / ?id= when present. */
const applyEnvFilter = [
  "if (envFilter) { data = data.filter((row) => env(row).toLowerCase() === envFilter.toLowerCase()); }",
].join("\n");

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                    */
/* -------------------------------------------------------------------------- */

const MAP_HEALTH_STATUS = [
  PRELUDE,
  queryOf("API 01 - GET health-status"),
  "",
  "let data = rows();",
  applyEnvFilter,
  "",
  "// Latest row per service (Health_Check_History is append-only).",
  "const latest = {};",
  "for (const row of data) {",
  "  const name = svcName(row);",
  "  if (!name) continue;",
  "  const key = env(row) + '::' + name;",
  "  const ts = S(pick(row, ['Timestamp', 'timestamp']));",
  "  if (!latest[key] || ts > S(pick(latest[key], ['Timestamp', 'timestamp']))) latest[key] = row;",
  "}",
  "",
  "const services = Object.keys(latest).map((key) => {",
  "  const row = latest[key];",
  "  const name = svcName(row);",
  "  const status = normStatus(pick(row, ['Health Status', 'healthStatus']));",
  "  const retryCount = NUM(pick(row, ['Retry Count', 'retryCount'], 0));",
  "  const threshold = NUM(pick(row, ['Response Time Threshold Ms', 'responseTimeThresholdMs'], 3000)) || 3000;",
  "  const endpoint = S(pick(row, ['Endpoint', 'url']));",
  "  return {",
  "    id: slug(name),",
  "    name: name,",
  "    application: S(pick(row, ['Application', 'application'], 'VWO')) || 'VWO',",
  "    environment: env(row),",
  "    checkType: (S(pick(row, ['Check Type', 'checkType'], 'HTTP')) || 'HTTP').toUpperCase(),",
  "    endpoint: endpoint,",
  "    url: endpoint,",
  "    httpMethod: 'GET',",
  "    expectedStatus: 200,",
  "    responseTimeThresholdMs: threshold,",
  "    critical: /main|login|api/i.test(name),",
  "    retryPolicy: { maxAttempts: 3, delaysSeconds: [20, 30] },",
  "    status: status,",
  "    httpStatus: NUM(pick(row, ['HTTP Status', 'httpStatus'], 0)) || null,",
  "    responseTimeMs: NUM(pick(row, ['Response Time Ms', 'responseTimeMs'], 0)),",
  "    attempts: retryCount + 1,",
  "    lastCheckedAt: isoTs(pick(row, ['Timestamp', 'timestamp'])),",
  "    consecutiveSlowChecks: status === 'SLOW' ? 1 : 0,",
  "  };",
  "});",
  "",
  "const totalRows = data.length;",
  "const passedRows = data.filter((row) => normStatus(pick(row, ['Health Status', 'healthStatus'])) === 'HEALTHY').length;",
  "const uptimePct = totalRows ? Math.round((passedRows / totalRows) * 10000) / 100 : 0;",
  "const downCount = services.filter((s) => s.status === 'DOWN' || s.status === 'FUNCTIONAL_FAILURE').length;",
  "const healthyCount = services.length - downCount;",
  "const avgMs = services.length",
  "  ? Math.round(services.reduce((sum, s) => sum + s.responseTimeMs, 0) / services.length)",
  "  : 0;",
  "const lastChecked = services.reduce((acc, s) => (s.lastCheckedAt && s.lastCheckedAt > acc ? s.lastCheckedAt : acc), '');",
  "",
  "return [{ json: {",
  "  summary: {",
  "    overallStatus: services.length === 0 ? 'UNKNOWN' : (healthyCount === 0 ? 'DOWN' : (uptimePct >= 99.9 ? 'HEALTHY' : 'SLOW')),",
  "    servicesMonitored: services.length,",
  "    healthyServices: healthyCount,",
  "    failedServices: downCount,",
  "    activeIncidents: 0,",
  "    averageResponseTimeMs: avgMs,",
  "    uptimePct: uptimePct,",
  "    lastCheckedAt: lastChecked || new Date().toISOString(),",
  "  },",
  "  services: services,",
  "} }];",
].join("\n");

const MAP_HEALTH_CHECKS = [
  PRELUDE,
  queryOf("API 02 - GET health-checks"),
  "",
  "let data = rows();",
  applyEnvFilter,
  "",
  "const out = data.map((row, index) => {",
  "  const status = normStatus(pick(row, ['Health Status', 'healthStatus']));",
  "  const retryCount = NUM(pick(row, ['Retry Count', 'retryCount'], 0));",
  "  const validation = S(pick(row, ['Functional Validation', 'validationResult'])).toUpperCase();",
  "  const errMsg = S(pick(row, ['Error Message', 'failureReason']));",
  "  const name = svcName(row);",
  "  return {",
  "    id: 'hc-' + (index + 1),",
  "    serviceId: slug(name),",
  "    serviceName: name,",
  "    environment: env(row),",
  "    attempt: retryCount + 1,",
  "    maxAttempts: 3,",
  "    status: status,",
  "    httpStatus: NUM(pick(row, ['HTTP Status', 'httpStatus'], 0)) || null,",
  "    responseTimeMs: NUM(pick(row, ['Response Time Ms', 'responseTimeMs'], 0)),",
  "    expectedTextFound: validation.indexOf('FAIL') === -1,",
  "    message: errMsg || (status === 'HEALTHY'",
  "      ? 'Check passed - HTTP status and functional assertions OK'",
  "      : 'Check completed with status ' + status),",
  "    checkedAt: isoTs(pick(row, ['Timestamp', 'timestamp'])),",
  "    n8nExecutionId: S(pick(row, ['Workflow Execution ID', 'runId'])),",
  "    failureReason: errMsg || undefined,",
  "  };",
  "});",
  "",
  "out.sort((a, b) => String(b.checkedAt || '').localeCompare(String(a.checkedAt || '')));",
  "return out.slice(0, MAX_ROWS).map((item) => ({ json: item }));",
].join("\n");

const MAP_LOGS = [
  PRELUDE,
  queryOf("API 03 - GET logs"),
  "",
  "let data = rows();",
  applyEnvFilter,
  "",
  "const out = data.map((row, index) => {",
  "  const status = normStatus(pick(row, ['Health Status', 'healthStatus']));",
  "  const retryCount = NUM(pick(row, ['Retry Count', 'retryCount'], 0));",
  "  const errMsg = S(pick(row, ['Error Message', 'failureReason']));",
  "  const name = svcName(row);",
  "  return {",
  "    id: 'log-' + (index + 1),",
  "    timestamp: isoTs(pick(row, ['Timestamp', 'timestamp'])),",
  "    serviceId: slug(name),",
  "    serviceName: name,",
  "    environment: env(row),",
  "    attempt: retryCount + 1,",
  "    maxAttempts: 3,",
  "    status: status,",
  "    httpCode: NUM(pick(row, ['HTTP Status', 'httpStatus'], 0)) || null,",
  "    responseTimeMs: NUM(pick(row, ['Response Time Ms', 'responseTimeMs'], 0)),",
  "    message: errMsg || 'HTTP ' + (NUM(pick(row, ['HTTP Status'], 0)) || 'n/a') + ' in ' + NUM(pick(row, ['Response Time Ms'], 0)) + ' ms',",
  "  };",
  "});",
  "",
  "out.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));",
  "return out.slice(0, MAX_ROWS).map((item) => ({ json: item }));",
].join("\n");

const MAP_RESPONSE_TIMES = [
  PRELUDE,
  queryOf("API 04 - GET response-times"),
  "",
  "let data = rows();",
  applyEnvFilter,
  "",
  "const out = data.map((row) => {",
  "  const name = svcName(row);",
  "  return {",
  "    timestamp: isoTs(pick(row, ['Timestamp', 'timestamp'])),",
  "    serviceId: slug(name),",
  "    serviceName: name,",
  "    responseTimeMs: NUM(pick(row, ['Response Time Ms', 'responseTimeMs'], 0)),",
  "    thresholdMs: NUM(pick(row, ['Response Time Threshold Ms'], 3000)) || 3000,",
  "  };",
  "});",
  "",
  "out.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));",
  "return out.slice(-MAX_ROWS).map((item) => ({ json: item }));",
].join("\n");

const MAP_UPTIME = [
  PRELUDE,
  queryOf("API 05 - GET uptime"),
  "",
  "let data = rows();",
  applyEnvFilter,
  "",
  "// Node \"24 - Aggregate Overall VWO Health\" also appends an OVERALL / ALL_SERVICES row.",
  "const overall = data.filter((row) => {",
  "  const service = S(pick(row, ['Service Name', 'serviceName'])).toUpperCase();",
  "  const environment = env(row).toUpperCase();",
  "  return service === 'ALL_SERVICES' || environment === 'OVERALL';",
  "});",
  "const source = overall.length > 0 ? overall : data;",
  "",
  "const out = source.map((row) => ({",
  "  date: S(pick(row, ['Date', 'date'])).slice(0, 10),",
  "  uptimePct: NUM(pick(row, ['Availability Percentage', 'availabilityPct'], 0)),",
  "  checks: NUM(pick(row, ['Total Checks', 'totalChecks'], 0)),",
  "  failedChecks: NUM(pick(row, ['Failed Checks', 'failedChecks'], 0)),",
  "}));",
  "",
  "return out.slice(-31).map((item) => ({ json: item }));",
].join("\n");

const MAP_INCIDENTS = [
  PRELUDE,
  queryOf("API 06 - GET incidents"),
  "",
  "const SEVERITY_MAP = { 'SEV-1': 'Critical', 'SEV-2': 'High', 'SEV-3': 'Medium', 'SEV-4': 'Low', CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };",
  "const INCIDENT_STATUS_MAP = { OPEN: 'Open', INVESTIGATING: 'Investigating', RECOVERED: 'Recovered', RESOLVED: 'Resolved', CLOSED: 'Resolved' };",
  "",
  "// Timeline is derived: Downtime_Incidents stores the run outcome, not each retry.",
  "const buildTimeline = (incidentId, serviceName, startedAt, recoveredAt, failureReason, retryAttempts, httpStatus, responseTimeMs) => {",
  "  const events = [];",
  "  const base = startedAt ? new Date(startedAt).getTime() : Date.now();",
  "  const at = (offsetSeconds) => new Date(base + offsetSeconds * 1000).toISOString();",
  "  const delays = [20, 30];",
  "  let cursor = 0;",
  "  events.push({ id: incidentId + '-t1', label: 'Initial health check failed', detail: 'HTTP ' + (httpStatus || 'n/a') + ' - ' + failureReason, at: at(0), kind: 'failure' });",
  "  for (let i = 0; i < Math.max(0, retryAttempts - 1); i += 1) {",
  "    const wait = delays[i] === undefined ? 30 : delays[i];",
  "    events.push({ id: incidentId + '-t' + (i + 2), label: 'Retry #' + (i + 1) + ' scheduled', detail: 'Wait: ' + wait + ' seconds', at: at(cursor + 1), kind: 'schedule' });",
  "    cursor = cursor + 1 + wait;",
  "    events.push({ id: incidentId + '-t' + (i + 2) + 'f', label: 'Retry #' + (i + 1) + ' failed', detail: 'HTTP ' + (httpStatus || 'n/a') + ' - ' + (responseTimeMs || 0) + ' ms', at: at(cursor - 1), kind: 'retry' });",
  "  }",
  "  events.push({ id: incidentId + '-tc', label: 'Incident created', detail: incidentId + ' opened for ' + serviceName, at: at(cursor), kind: 'incident' });",
  "  if (recoveredAt) {",
  "    events.push({ id: incidentId + '-tr', label: 'Service recovered', detail: 'Availability restored', at: recoveredAt, kind: 'recovery' });",
  "  }",
  "  return events;",
  "};",
  "",
  "let data = rows();",
  applyEnvFilter,
  "if (idFilter) { data = data.filter((row) => S(pick(row, ['Incident ID', 'incidentId'])).toLowerCase() === idFilter.toLowerCase()); }",
  "",
  "const out = data.map((row) => {",
  "  const incidentId = S(pick(row, ['Incident ID', 'incidentId']));",
  "  const name = svcName(row);",
  "  const startedAt = isoTs(pick(row, ['Downtime Start', 'Detected At', 'Timestamp', 'downtimeStart']));",
  "  const recoveredAt = isoTs(pick(row, ['Recovery Time', 'recoveryTime']));",
  "  const status = INCIDENT_STATUS_MAP[S(pick(row, ['Status'], 'OPEN')).toUpperCase()] || 'Open';",
  "  const httpStatus = NUM(pick(row, ['HTTP Status', 'httpStatus'], 0)) || null;",
  "  const responseTimeMs = NUM(pick(row, ['Response Time Ms', 'responseTimeMs'], 0));",
  "  const retryAttempts = NUM(pick(row, ['Retry Count', 'Attempt Count'], status === 'Open' ? 3 : 2)) || 1;",
  "  const storedSeconds = NUM(pick(row, ['Downtime Seconds', 'downtimeSeconds'], 0));",
  "  const computedSeconds = startedAt ? Math.max(0, Math.round(((recoveredAt ? new Date(recoveredAt).getTime() : Date.now()) - new Date(startedAt).getTime()) / 1000)) : 0;",
  "  const failureReason = S(pick(row, ['Failure Reason', 'failureReason'], 'Health check failed'));",
  "  return {",
  "    id: incidentId,",
  "    serviceId: slug(name),",
  "    serviceName: name,",
  "    application: S(pick(row, ['Application'], 'VWO')) || 'VWO',",
  "    environment: env(row),",
  "    status: status,",
  "    severity: SEVERITY_MAP[S(pick(row, ['Severity'], 'SEV-3')).toUpperCase()] || 'Medium',",
  "    detectedAt: startedAt,",
  "    startedAt: startedAt,",
  "    recoveredAt: recoveredAt,",
  "    durationSeconds: storedSeconds || computedSeconds,",
  "    retryAttempts: retryAttempts,",
  "    failureReason: failureReason,",
  "    httpResponse: S(pick(row, ['HTTP Response', 'Response Snippet'], 'HTTP ' + (httpStatus || 'n/a') + ' for ' + S(pick(row, ['Endpoint', 'url'])))),",
  "    n8nExecutionId: S(pick(row, ['Workflow Execution ID', 'runId', 'Execution ID'])),",
  "    timeline: buildTimeline(incidentId, name, startedAt, recoveredAt, failureReason, retryAttempts, httpStatus, responseTimeMs),",
  "  };",
  "});",
  "",
  "out.sort((a, b) => String(b.detectedAt || '').localeCompare(String(a.detectedAt || '')));",
  "return out.slice(0, MAX_ROWS).map((item) => ({ json: item }));",
].join("\n");

const MAP_RETRY_HISTORY = [
  PRELUDE,
  queryOf("API 07 - GET retry-history"),
  "",
  "let data = rows();",
  applyEnvFilter,
  "",
  "// Retry attempts are NOT persisted individually - derive them from each incident",
  "// using the workflow's fixed policy (3 attempts, 20 s then 30 s waits).",
  "const out = [];",
  "for (const row of data) {",
  "  const incidentId = S(pick(row, ['Incident ID', 'incidentId']));",
  "  const name = svcName(row);",
  "  const startedAt = isoTs(pick(row, ['Downtime Start', 'Detected At', 'Timestamp']));",
  "  const recoveredAt = isoTs(pick(row, ['Recovery Time', 'recoveryTime']));",
  "  const status = S(pick(row, ['Status'], 'OPEN')).toUpperCase();",
  "  const httpStatus = NUM(pick(row, ['HTTP Status'], 0)) || null;",
  "  const base = startedAt ? new Date(startedAt).getTime() : Date.now();",
  "  const at = (seconds) => new Date(base + seconds * 1000).toISOString();",
  "  const delays = [20, 30];",
  "  out.push({ id: incidentId + '-r0', serviceId: slug(name), serviceName: name, incidentId: incidentId, attempt: 1, outcome: 'failed', at: at(0), message: 'Initial health check failed - HTTP ' + (httpStatus || 'n/a') });",
  "  let cursor = 0;",
  "  for (let i = 0; i < delays.length; i += 1) {",
  "    out.push({ id: incidentId + '-r' + (i + 1) + 's', serviceId: slug(name), serviceName: name, incidentId: incidentId, attempt: i + 2, outcome: 'scheduled', scheduledDelaySeconds: delays[i], at: at(cursor + 1), message: 'Retry #' + (i + 1) + ' scheduled' });",
  "    cursor = cursor + 1 + delays[i];",
  "    const recovered = recoveredAt && new Date(recoveredAt).getTime() <= base + cursor * 1000;",
  "    out.push({ id: incidentId + '-r' + (i + 1), serviceId: slug(name), serviceName: name, incidentId: incidentId, attempt: i + 2, outcome: recovered ? 'succeeded' : 'failed', at: at(cursor - 1), message: recovered ? 'Retry #' + (i + 1) + ' succeeded - service recovered' : 'Retry #' + (i + 1) + ' failed - retries exhausted' });",
  "    if (recovered) break;",
  "  }",
  "  if (status === 'RESOLVED' || status === 'RECOVERED') {",
  "    out.push({ id: incidentId + '-rc', serviceId: slug(name), serviceName: name, incidentId: incidentId, attempt: 1, outcome: 'info', at: recoveredAt || at(cursor), message: incidentId + ' marked ' + status.toLowerCase() });",
  "  } else {",
  "    out.push({ id: incidentId + '-rc', serviceId: slug(name), serviceName: name, incidentId: incidentId, attempt: 1, outcome: 'info', at: at(cursor), message: incidentId + ' created' });",
  "  }",
  "}",
  "",
  "out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));",
  "return out.slice(0, MAX_ROWS).map((item) => ({ json: item }));",
].join("\n");

const MAP_SETTINGS = [
  PRELUDE,
  "",
  "const data = rows();",
  "const defaults = {",
  "  responseTimeThresholdMs: 3000,",
  "  retryAttempts: 3,",
  "  retryDelaysSeconds: [20, 30],",
  "  checkIntervalMinutes: 5,",
  "  environments: [",
  "    { environment: 'QA', baseUrl: 'https://app.vwo.com', enabled: true, criticality: 'Critical' },",
  "    { environment: 'Staging', baseUrl: 'https://staging.vwo.com', enabled: false, criticality: 'High' },",
  "    { environment: 'Production', baseUrl: 'https://app.vwo.com', enabled: false, criticality: 'Critical' },",
  "  ],",
  "};",
  "",
  "// Optional `Settings` sheet with Key / Value columns overrides the defaults.",
  "const map = {};",
  "for (const row of data) {",
  "  const key = S(pick(row, ['Key', 'key']));",
  "  if (key) map[key] = pick(row, ['Value', 'value']);",
  "}",
  "",
  "const settings = JSON.parse(JSON.stringify(defaults));",
  "if (map.responseTimeThresholdMs) settings.responseTimeThresholdMs = NUM(map.responseTimeThresholdMs);",
  "if (map.retryAttempts) settings.retryAttempts = NUM(map.retryAttempts);",
  "if (map.retryDelaysSeconds) settings.retryDelaysSeconds = S(map.retryDelaysSeconds).split(',').map(NUM).filter((n) => n > 0);",
  "if (map.checkIntervalMinutes) settings.checkIntervalMinutes = NUM(map.checkIntervalMinutes);",
  "",
  "return [{ json: settings }];",
].join("\n");

const MAP_SETTINGS_WRITE = [
  PRELUDE,
  "// Normalises the POSTed settings into Key / Value rows for the `Settings` sheet.",
  "let body = {};",
  "try { body = $('API 09 - POST settings').first().json.body || {}; } catch (e) { body = {}; }",
  "const rowsOut = [",
  "  { Key: 'responseTimeThresholdMs', Value: String(NUM(body.responseTimeThresholdMs) || 3000) },",
  "  { Key: 'retryAttempts', Value: String(NUM(body.retryAttempts) || 3) },",
  "  { Key: 'retryDelaysSeconds', Value: (body.retryDelaysSeconds || [20, 30]).join(',') },",
  "  { Key: 'checkIntervalMinutes', Value: String(NUM(body.checkIntervalMinutes) || 5) },",
  "  { Key: 'updatedAt', Value: new Date().toISOString() },",
  "];",
  "return rowsOut.map((row) => ({ json: row }));",
].join("\n");

const MAP_RESOLVE_INCIDENT = [
  PRELUDE,
  "let body = {};",
  "try { body = $('API 10 - POST incidents-resolve').first().json.body || {}; } catch (e) { body = {}; }",
  "const incidentId = S(body.incidentId);",
  "if (!incidentId) { return [{ json: { ok: false, error: 'incidentId is required' } }]; }",
  "return [{ json: {",
  "  'Incident ID': incidentId,",
  "  'Status': 'RESOLVED',",
  "  'Recovery Time': Date.now ? new Date(Date.now() + 19800000).toISOString().replace('T', ' ').slice(0, 19) : '',",
  "  'Resolved By': 'VWO QA Downtime Tracker dashboard',",
  "} }];",
].join("\n");

/* -------------------------------------------------------------------------- */
/*  Node factories                                                             */
/* -------------------------------------------------------------------------- */

let idCounter = 0;
const uid = (prefix) => {
  idCounter += 1;
  return `${prefix}-${String(idCounter).padStart(3, "0")}-e7b1a4c9`;
};

const nodes = [];
const connections = {};

function webhook(name, path, method, position, webhookId) {
  nodes.push({
    parameters: {
      httpMethod: method.toLowerCase(),
      path,
      responseMode: "responseNode",
      options: {},
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position,
    id: uid("wh"),
    name,
    webhookId,
  });
  return name;
}

function sheetsRead(name, sheetName, position, { tolerant = false } = {}) {
  const node = {
    parameters: {
      documentId: { __rl: true, mode: "list", value: SPREADSHEET_ID },
      sheetName: { __rl: true, mode: "list", value: sheetName },
      options: {},
    },
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position,
    id: uid("gs"),
    name,
  };
  if (tolerant) {
    // Optional tab: a missing/empty sheet must yield zero items instead of
    // failing the webhook (the mapper then returns its documented defaults).
    node.onError = "continueRegularOutput";
    node.alwaysOutputData = true;
  }
  nodes.push(node);
  return name;
}

function sheetsUpsert(name, sheetName, matchingColumn, position) {
  nodes.push({
    parameters: {
      operation: "appendOrUpdate",
      documentId: { __rl: true, mode: "list", value: SPREADSHEET_ID },
      sheetName: { __rl: true, mode: "list", value: sheetName },
      columns: {
        mappingMode: "autoMapInputData",
        value: {},
        matchingColumns: [matchingColumn],
        schema: [],
      },
      options: {},
    },
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position,
    id: uid("gs"),
    name,
  });
  return name;
}

function code(name, jsCode, position) {
  nodes.push({
    parameters: { mode: "runOnceForAllItems", language: "javascript", jsCode },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    id: uid("code"),
    name,
  });
  return name;
}

function respond(name, position, note) {
  nodes.push({
    parameters: {
      respondWith: "allIncomingItems",
      options: { responseCode: 200 },
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position,
    id: uid("resp"),
    name,
    notes: note || "",
  });
  return name;
}

function executeWorkflow(name, position) {
  nodes.push({
    parameters: {
      workflowId: { __rl: true, mode: "list", value: MONITOR_WORKFLOW_ID },
      workflowMode: "list",
      options: { waitForSubWorkflow: false },
    },
    type: "n8n-nodes-base.executeWorkflow",
    typeVersion: 1.2,
    position,
    id: uid("exec"),
    name,
  });
  return name;
}

/** Wires a linear chain. */
function chain(...chainNodes) {
  for (let i = 0; i < chainNodes.length - 1; i += 1) {
    connections[chainNodes[i]] = {
      main: [[{ node: chainNodes[i + 1], type: "main", index: 0 }]],
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Branches                                                                   */
/* -------------------------------------------------------------------------- */

const COL = { hooks: 0, sheets: 260, code: 620, respond: 1020, after: 1280 };
const ROW = 240;

const branches = [
  {
    path: "health-status",
    method: "GET",
    sheet: "Health_Check_History",
    names: ["API 01 - GET health-status", "API 01a - Read Health Check History", "API 01b - Build Services + Summary", "API 01c - Respond health-status"],
    mapper: MAP_HEALTH_STATUS,
    note: "Returns { summary, services } - the dashboard's primary payload.",
  },
  {
    path: "health-checks",
    method: "GET",
    sheet: "Health_Check_History",
    names: ["API 02 - GET health-checks", "API 02a - Read Health Check History", "API 02b - Map Health Checks", "API 02c - Respond health-checks"],
    mapper: MAP_HEALTH_CHECKS,
    note: "HealthCheck[] - one item per recorded check.",
  },
  {
    path: "logs",
    method: "GET",
    sheet: "Health_Check_History",
    names: ["API 03 - GET logs", "API 03a - Read Health Check History", "API 03b - Map Log Entries", "API 03c - Respond logs"],
    mapper: MAP_LOGS,
    note: "LogEntry[] - flattened check log.",
  },
  {
    path: "response-times",
    method: "GET",
    sheet: "Health_Check_History",
    names: ["API 04 - GET response-times", "API 04a - Read Health Check History", "API 04b - Map Response Times", "API 04c - Respond response-times"],
    mapper: MAP_RESPONSE_TIMES,
    note: "ResponseTimeMetric[] - 24h latency series.",
  },
  {
    path: "uptime",
    method: "GET",
    sheet: "Daily_Availability",
    names: ["API 05 - GET uptime", "API 05a - Read Daily Availability", "API 05b - Map Uptime", "API 05c - Respond uptime"],
    mapper: MAP_UPTIME,
    note: "UptimePoint[] - daily availability (OVERALL / ALL_SERVICES rows).",
  },
  {
    path: "incidents",
    method: "GET",
    sheet: "Downtime_Incidents",
    names: ["API 06 - GET incidents", "API 06a - Read Downtime Incidents", "API 06b - Map Incidents", "API 06c - Respond incidents"],
    mapper: MAP_INCIDENTS,
    note: "Incident[] - supports ?id=INC-... and ?environment=QA.",
  },
  {
    path: "retry-history",
    method: "GET",
    sheet: "Downtime_Incidents",
    names: ["API 07 - GET retry-history", "API 07a - Read Downtime Incidents", "API 07b - Derive Retry Attempts", "API 07c - Respond retry-history"],
    mapper: MAP_RETRY_HISTORY,
    note: "RetryAttempt[] - derived from incident rows using the 20s/30s policy.",
  },
];

let rowIndex = 0;
for (const branch of branches) {
  const y = 240 + rowIndex * ROW;
  rowIndex += 1;

  const [hook, read, mapper, respondNode] = branch.names;
  webhook(hook, branch.path, branch.method, [COL.hooks, y], `vwo-qa-${branch.path}`);
  sheetsRead(read, branch.sheet, [COL.sheets, y]);
  code(mapper, branch.mapper, [COL.code, y]);
  respond(respondNode, [COL.respond, y], branch.note);
  chain(hook, read, mapper, respondNode);
}

/* --- POST /health-check : acknowledge, then run the monitoring workflow ---- */
{
  const y = 240 + rowIndex * ROW;
  rowIndex += 1;
  const hook = webhook("API 08 - POST health-check", "health-check", "POST", [COL.hooks, y], "vwo-qa-health-check");
  const mapper = code(
    "API 08a - Acknowledge Health Check",
    [
      "let body = {};",
      "try { body = $('API 08 - POST health-check').first().json.body || {}; } catch (e) { body = {}; }",
      "const S = (v) => (v === undefined || v === null) ? '' : String(v).trim();",
      "const environment = S(body.environment) || 'QA';",
      "let executionId = '';",
      "try { executionId = 'exec-' + $execution.id; } catch (e) { executionId = 'exec-' + Date.now(); }",
      "return [{ json: {",
      "  ok: true,",
      "  triggeredAt: new Date().toISOString(),",
      "  environment: environment,",
      "  executionId: executionId,",
      "  services: [],",
      "  message: 'Health check queued. The monitoring workflow has been triggered; refresh in a few seconds for the new results.',",
      "} }];",
    ].join("\n"),
    [COL.code, y],
  );
  const respondNode = respond("API 08b - Respond health-check", [COL.respond, y], "Answers immediately, then triggers the monitor workflow.");
  const runner = executeWorkflow("API 08c - Run Monitoring Workflow", [COL.after, y]);
  chain(hook, mapper, respondNode, runner);
}

/* --- GET /settings -------------------------------------------------------- */
{
  const y = 240 + rowIndex * ROW;
  rowIndex += 1;
  const hook = webhook("API 09 - GET settings", "settings", "GET", [COL.hooks, y], "vwo-qa-settings-get");
  const read = sheetsRead("API 09a - Read Settings Sheet", "Settings", [COL.sheets, y], { tolerant: true });
  const mapper = code("API 09b - Build Settings", MAP_SETTINGS, [COL.code, y]);
  const respondNode = respond("API 09c - Respond settings", [COL.respond, y], "DashboardSettings - falls back to documented defaults when the Settings sheet is missing or empty.");
  chain(hook, read, mapper, respondNode);
}

/* --- POST /settings ------------------------------------------------------- */
{
  const y = 240 + rowIndex * ROW;
  rowIndex += 1;
  const hook = webhook("API 10 - POST settings", "settings-write", "POST", [COL.hooks, y], "vwo-qa-settings-post");
  const mapper = code("API 10a - Normalise Settings Rows", MAP_SETTINGS_WRITE, [COL.code, y]);
  const write = sheetsUpsert("API 10b - Upsert Settings", "Settings", "Key", [COL.respond, y]);
  const respondNode = respond("API 10c - Respond settings-write", [COL.after, y], "Persists Key/Value settings rows.");
  chain(hook, mapper, write, respondNode);
}

/* --- POST /incidents-resolve --------------------------------------------- */
{
  const y = 240 + rowIndex * ROW;
  rowIndex += 1;
  const hook = webhook("API 11 - POST incidents-resolve", "incidents-resolve", "POST", [COL.hooks, y], "vwo-qa-incidents-resolve");
  const mapper = code("API 11a - Build Resolution Row", MAP_RESOLVE_INCIDENT, [COL.code, y]);
  const write = sheetsUpsert("API 11b - Upsert Incident Resolution", "Downtime_Incidents", "Incident ID", [COL.respond, y]);
  const respondNode = respond("API 11c - Respond incidents-resolve", [COL.after, y], "Marks an incident RESOLVED in Downtime_Incidents.");
  chain(hook, mapper, write, respondNode);
}

/* -------------------------------------------------------------------------- */
/*  Sticky note documenting the contract                                       */
/* -------------------------------------------------------------------------- */

nodes.push({
  parameters: {
    content:
      "## VWO QA Dashboard - read API\n\n" +
      "Webhook layer for the VWO QA Downtime Tracker dashboard.\n" +
      "All data comes from the sheets written by `09_DownTime_Tracker`.\n\n" +
      "| Endpoint | Sheet |\n| --- | --- |\n" +
      "| GET /health-status | Health_Check_History |\n" +
      "| GET /health-checks | Health_Check_History |\n" +
      "| GET /logs | Health_Check_History |\n" +
      "| GET /response-times | Health_Check_History |\n" +
      "| GET /uptime | Daily_Availability |\n" +
      "| GET /incidents | Downtime_Incidents |\n" +
      "| GET /retry-history | Downtime_Incidents (derived) |\n" +
      "| POST /health-check | triggers the monitor workflow |\n" +
      "| GET /settings, POST /settings-write | Settings (Key/Value) |\n" +
      "| POST /incidents-resolve | Downtime_Incidents |\n\n" +
      "**Setup:**\n" +
      "1. Replace `REPLACE_WITH_SPREADSHEET_ID` in every Google Sheets node (10) and\n" +
      "   `REPLACE_WITH_MONITOR_WORKFLOW_ID` in `API 08c`.\n" +
      "2. Attach your Google Sheets credential to those nodes.\n" +
      "3. **Activate** the workflow - webhooks only respond while it is active.\n\n" +
      "**Workbook tabs required**\n\n" +
      "- `Health_Check_History` (written by the monitor)\n" +
      "- `Downtime_Incidents` (written by the monitor)\n" +
      "- `Daily_Availability` (written by the monitor)\n" +
      "- `Settings` (optional - has Key/Value columns; when absent,\n" +
      "  `GET /settings` returns defaults because `API 09a` is set to continue on error)\n\n" +
      "Base URL of the webhooks: `https://<your-instance>/webhook/<path>`\n\n" +
      "**Note:** the monitor workflow emits `UP` / `DOWN` / `DEGRADED` / `FUNCTIONAL_FAILURE`;\n" +
      "the mappers normalise these to the dashboard's `HEALTHY` / `DOWN` / `SLOW` / `FUNCTIONAL_FAILURE`.",
    height: 640,
    width: 460,
    color: 4,
  },
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position: [-260, 240],
  id: uid("note"),
  name: "README - Dashboard API",
});

/* -------------------------------------------------------------------------- */
/*  Emit                                                                       */
/* -------------------------------------------------------------------------- */

const nodeNames = new Set(nodes.map((n) => n.name));
if (nodeNames.size !== nodes.length) throw new Error("Duplicate node names detected");

for (const [from, value] of Object.entries(connections)) {
  if (!nodeNames.has(from)) throw new Error(`Connection source missing: ${from}`);
  for (const targets of value.main) {
    for (const target of targets) {
      if (!nodeNames.has(target.node)) throw new Error(`Connection target missing: ${target.node}`);
    }
  }
}

// Every functional node must sit on a chain (stickies are allowed to float).
const wired = new Set([...Object.keys(connections)]);
for (const value of Object.values(connections)) {
  for (const targets of value.main) {
    for (const target of targets) wired.add(target.node);
  }
}
const orphans = nodes
  .filter((n) => n.type !== "n8n-nodes-base.stickyNote" && !wired.has(n.name))
  .map((n) => n.name);
if (orphans.length > 0) throw new Error(`Disconnected nodes: ${orphans.join(", ")}`);

const workflow = {
  name: "09b_DownTime_Tracker_API",
  nodes,
  connections,
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  meta: {
    instanceId: "vwo-qa-downtime-tracker-dashboard-api",
    templateCredsSetupCompleted: false,
  },
  tags: [],
};

const outPath = new URL("./09_DownTime_Tracker.API.json", import.meta.url);
writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");

/* -------------------------------------------------------------------------- */
/*  Report                                                                     */
/* -------------------------------------------------------------------------- */

const webhooks = nodes.filter((n) => n.type === "n8n-nodes-base.webhook");
const tolerantReads = nodes.filter(
  (n) => n.type === "n8n-nodes-base.googleSheets" && n.onError === "continueRegularOutput",
);
const strictReads = nodes.filter(
  (n) =>
    n.type === "n8n-nodes-base.googleSheets" &&
    n.parameters.operation !== "appendOrUpdate" &&
    n.onError === undefined,
);

console.log(`Generated ${workflow.nodes.length} nodes -> 09_DownTime_Tracker.API.json\n`);
console.log("Endpoints:");
for (const hook of webhooks) {
  console.log(`  ${hook.parameters.httpMethod.toUpperCase().padEnd(4)} /${hook.parameters.path}`);
}
console.log(`\nSheet tabs required: ${[...new Set(
  nodes
    .filter((n) => n.type === "n8n-nodes-base.googleSheets")
    .map((n) => n.parameters.sheetName.value),
)].join(", ")}`);
console.log(`Tolerant (optional) sheet reads: ${tolerantReads.map((n) => n.name).join(", ") || "none"}`);
console.log(`Strict sheet reads: ${strictReads.length}`);
