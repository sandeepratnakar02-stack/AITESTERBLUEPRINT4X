/**
 * Local stub of the n8n webhook API — reproduces the payload shapes returned by
 * `01_VWO_Downtime_Monitor.json` + `02_VWO_Downtime_Tracker_API.json`.
 *
 *   node scripts/stub-n8n-api.mjs              # pre-patch behaviour
 *   node scripts/stub-n8n-api.mjs --patched    # post-patch behaviour
 *
 * `--patched` mirrors the fixes applied by `n8n/patch-workflows.mjs`: HEALTHY /
 * SLOW mapping, an availability value computed over the window, DOWN reserved
 * for critical failures and timestamps on derived retry events.
 *
 * Use it to verify the dashboard before or without a live n8n instance:
 *
 *   node scripts/stub-n8n-api.mjs --patched
 *   USE_LIVE_DATA=true N8N_BASE_URL=http://127.0.0.1:5999 npm run dev
 *
 * Every endpoint logs the request so you can see what the dashboard asks for.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 5999);
const PATCHED = process.argv.includes("--patched");

/** Google Sheets style timestamp (no timezone), as written by the monitor. */
function sheetTimestamp(minutesAgo) {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isoDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

const SERVICES = [
  { name: "VWO Main Application", critical: true, httpStatus: 200, responseTimeMs: 724, up: true },
  { name: "VWO Login", critical: true, httpStatus: 200, responseTimeMs: 910, up: true },
  { name: "VWO Campaign Dashboard", critical: false, httpStatus: 200, responseTimeMs: 3400, up: true },
  { name: "VWO API", critical: true, httpStatus: 200, responseTimeMs: 412, up: true },
  { name: "VWO Editor", critical: false, httpStatus: 500, responseTimeMs: 5800, up: false },
];

/**
 * Mirrors `API 01b - Build Services + Summary` — including its quirk that a
 * healthy service without `expectedText` (functionalValidation
 * NOT_APPLICABLE) comes back as UNKNOWN.
 */
function serviceRow(service, minutesAgo) {
  const thresholdMs = 3000;
  return {
    name: service.name,
    application: "VWO",
    environment: "QA",
    checkType: "HTTP",
    endpoint: "https://app.vwo.com/",
    httpStatus: service.httpStatus,
    responseTimeMs: service.responseTimeMs,
    responseTimeThresholdMs: thresholdMs,
    status: PATCHED
      ? service.up
        ? service.responseTimeMs > thresholdMs
          ? "SLOW"
          : "HEALTHY"
        : "DOWN"
      : "UNKNOWN", // pre-patch: UP + NOT_APPLICABLE never satisfied the HEALTHY branch
    functionalValidation: "NOT_APPLICABLE",
    retryCount: service.up ? 0 : 2,
    errorMessage: service.up ? "" : "Request failed with status code 500",
    critical: service.critical,
    lastCheckedAt: sheetTimestamp(minutesAgo),
  };
}

function historyRows() {
  const rows = [];
  for (let i = 0; i < 24; i += 1) {
    for (const service of SERVICES) {
      if (!service.up && i > 2) continue; // outage is recent
      rows.push({
        timestamp: sheetTimestamp(i * 30 + 4),
        application: "VWO",
        environment: "QA",
        serviceName: service.name,
        checkType: "HTTP",
        endpoint: "https://app.vwo.com/",
        httpStatus: i < 3 && !service.up ? 500 : service.httpStatus,
        responseTimeMs: i < 3 && !service.up ? 5800 : service.responseTimeMs,
        responseTimeThresholdMs: 3000,
        healthStatus: i < 3 && !service.up ? "DOWN" : service.responseTimeMs > 3000 ? "DEGRADED" : "UP",
        functionalValidation: "NOT_APPLICABLE",
        retryCount: i < 3 && !service.up ? 2 : 0,
        errorMessage: i < 3 && !service.up ? "Request failed with status code 500" : "",
        workflowExecutionId: String(9100 + i),
        critical: service.critical,
      });
    }
  }
  return rows;
}

const INCIDENTS = [
  {
    incidentId: "INC-20260910093604-vwo-editor",
    application: "VWO",
    environment: "QA",
    serviceName: "VWO Editor",
    endpoint: "https://app.vwo.com/",
    status: "OPEN",
    severity: "SEV-3",
    downtimeStart: sheetTimestamp(6),
    recoveryTime: "",
    downtimeSeconds: 0,
    retryCount: 2,
    httpStatus: 500,
    responseTimeMs: 5800,
    failureReason: "Request failed with status code 500",
    httpResponse: "<html><body>500 Internal Server Error</body></html>",
    workflowExecutionId: "9102",
    resolvedAt: "",
    resolvedBy: "",
    timeline: [
      { type: "INCIDENT_STARTED", timestamp: sheetTimestamp(6), message: "Service failure detected" },
      {
        type: "RETRY",
        attempt: 2,
        delaySeconds: 20,
        // Pre-patch these events carried no timestamp at all.
        ...(PATCHED ? { timestamp: sheetTimestamp(5.6) } : {}),
        message: "Retry attempt after 20 seconds",
      },
      {
        type: "RETRY",
        attempt: 3,
        delaySeconds: 30,
        ...(PATCHED ? { timestamp: sheetTimestamp(5) } : {}),
        message: "Final retry attempt after 30 seconds",
      },
    ],
  },
  {
    incidentId: "INC-20260909151240-vwo-campaign-dashboard",
    application: "VWO",
    environment: "QA",
    serviceName: "VWO Campaign Dashboard",
    endpoint: "https://app.vwo.com/",
    status: "RESOLVED",
    severity: "SEV-1",
    downtimeStart: sheetTimestamp(1180),
    recoveryTime: sheetTimestamp(1156),
    downtimeSeconds: 134,
    retryCount: 1,
    httpStatus: 200,
    responseTimeMs: 3480,
    failureReason: "Response time exceeded threshold",
    httpResponse: "HTTP 200 in 3480 ms",
    workflowExecutionId: "9044",
    resolvedAt: sheetTimestamp(1100),
    resolvedBy: "manual",
    timeline: [
      { type: "INCIDENT_STARTED", timestamp: sheetTimestamp(1180), message: "Service failure detected" },
      { type: "RETRY", attempt: 2, delaySeconds: 20, message: "Retry attempt after 20 seconds" },
      { type: "RECOVERED", timestamp: sheetTimestamp(1156), message: "Service recovered" },
      { type: "RESOLVED", timestamp: sheetTimestamp(1100), message: "Incident resolved by manual" },
    ],
  },
];

const history = historyRows();

function logsFromHistory() {
  return history.map((row) => {
    const level =
      row.healthStatus === "DOWN" || row.functionalValidation === "FAIL"
        ? "ERROR"
        : row.healthStatus === "DEGRADED"
          ? "WARN"
          : "INFO";
    let message = `${row.serviceName} health check`;
    message += row.healthStatus === "UP" ? ` passed (${row.httpStatus})` : ` returned ${row.healthStatus}`;
    if (row.errorMessage) message += ` - ${row.errorMessage}`;
    return {
      timestamp: row.timestamp,
      level,
      application: row.application,
      environment: row.environment,
      serviceName: row.serviceName,
      checkType: row.checkType,
      endpoint: row.endpoint,
      httpStatus: row.httpStatus,
      responseTimeMs: row.responseTimeMs,
      healthStatus: row.healthStatus,
      functionalValidation: row.functionalValidation,
      retryCount: row.retryCount,
      message,
      errorMessage: row.errorMessage,
      workflowExecutionId: row.workflowExecutionId,
      critical: row.critical,
    };
  });
}

const ROUTES = {
  "health-status": () => {
    const services = SERVICES.map((service, index) => serviceRow(service, index * 7 + 3));
    const failed = services.filter((s) => s.status === "DOWN").length;
    const healthy = services.filter((s) => s.status === "HEALTHY").length;
    const slow = services.filter((s) => s.status === "SLOW").length;
    const criticalFailures = services.filter(
      (s) => s.status === "DOWN" && s.critical,
    ).length;

    const unavailable = history.filter(
      (row) => row.healthStatus === "DOWN" || row.healthStatus === "FUNCTIONAL_FAILURE",
    ).length;

    return {
      summary: {
        overallStatus: PATCHED
          ? criticalFailures > 0
            ? "DOWN"
            : failed > 0 || slow > 0
              ? "DEGRADED"
              : "HEALTHY"
          : failed > 0
            ? "DOWN"
            : slow > 0
              ? "DEGRADED"
              : "HEALTHY",
        servicesMonitored: services.length,
        healthyServices: healthy,
        failedServices: failed,
        activeIncidents: 0,
        averageResponseTimeMs: Math.round(
          services.reduce((sum, s) => sum + s.responseTimeMs, 0) / services.length,
        ),
        uptimePct: PATCHED
          ? Number((((history.length - unavailable) / history.length) * 100).toFixed(2))
          : Number(((healthy / services.length) * 100).toFixed(2)),
        lastCheckedAt: services.map((s) => s.lastCheckedAt).sort().at(-1),
        environment: "QA",
      },
      services,
    };
  },

  "health-checks": () => ({
    environment: "QA",
    count: history.length,
    healthChecks: [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  }),

  logs: () => {
    const logs = logsFromHistory();
    return { environment: "QA", count: logs.length, logs: logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)) };
  },

  "response-times": () => ({
    environment: "QA",
    count: history.length,
    summary: { averageResponseTimeMs: 2248, minResponseTimeMs: 380, maxResponseTimeMs: 5800 },
    responseTimes: history.map((row) => ({
      timestamp: row.timestamp,
      application: row.application,
      environment: row.environment,
      serviceName: row.serviceName,
      endpoint: row.endpoint,
      responseTimeMs: row.responseTimeMs,
      thresholdMs: row.responseTimeThresholdMs,
      httpStatus: row.httpStatus,
      status: row.healthStatus === "DOWN" ? "DOWN" : row.responseTimeMs > 3000 ? "SLOW" : "HEALTHY",
      workflowExecutionId: row.workflowExecutionId,
    })),
  }),

  uptime: () => ({
    environment: "QA",
    count: 7,
    summary: { currentUptimePct: 99.96, totalChecks: 1440, failedChecks: 1, lastUpdatedAt: sheetTimestamp(60) },
    uptime: [6, 5, 4, 3, 2, 1, 0].map((daysAgo, index) => ({
      date: isoDate(daysAgo),
      application: "VWO",
      environment: "OVERALL",
      serviceName: "ALL_SERVICES",
      totalChecks: 1440,
      failedChecks: [0, 0, 1, 0, 2, 1, 1][index],
      availabilityPercentage: [100, 100, 99.93, 100, 99.86, 99.93, 99.96][index],
      updatedAt: sheetTimestamp(60),
    })),
  }),

  incidents: () => ({
    environment: "QA",
    count: INCIDENTS.length,
    activeIncidents: INCIDENTS.filter((i) => i.status === "OPEN").length,
    incidents: INCIDENTS,
  }),

  "retry-history": () => {
    const retryHistory = [];
    for (const incident of INCIDENTS) {
      if (incident.retryCount >= 1) {
        retryHistory.push({
          incidentId: incident.incidentId,
          application: incident.application,
          environment: incident.environment,
          serviceName: incident.serviceName,
          endpoint: incident.endpoint,
          attempt: 2,
          retryNumber: 1,
          delaySeconds: 20,
          status: incident.status,
          severity: incident.severity,
          httpStatus: incident.httpStatus,
          responseTimeMs: incident.responseTimeMs,
          failureReason: incident.failureReason,
          workflowExecutionId: incident.workflowExecutionId,
          incidentStartedAt: incident.downtimeStart,
        });
      }
      if (incident.retryCount >= 2) {
        retryHistory.push({
          incidentId: incident.incidentId,
          application: incident.application,
          environment: incident.environment,
          serviceName: incident.serviceName,
          endpoint: incident.endpoint,
          attempt: 3,
          retryNumber: 2,
          delaySeconds: 30,
          status: incident.status,
          severity: incident.severity,
          httpStatus: incident.httpStatus,
          responseTimeMs: incident.responseTimeMs,
          failureReason: incident.failureReason,
          workflowExecutionId: incident.workflowExecutionId,
          incidentStartedAt: incident.downtimeStart,
        });
      }
    }
    return { environment: "QA", count: retryHistory.length, retryHistory };
  },

  settings: () => ({
    settings: {
      responseTimeThresholdMs: 3000,
      retryAttempts: 3,
      retryDelaysSeconds: [20, 30],
      checkIntervalMinutes: 5,
      environments: ["QA", "Staging", "Production"],
    },
  }),
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const path = url.pathname.replace(/^\/webhook\/?/, "").replace(/\/$/, "");

  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body, null, 2));
  };

  if (request.method === "POST") {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      console.log(`POST /webhook/${path} body=${JSON.stringify(body)}`);

      if (path === "health-check") {
        // Mirrors "API 08a - Acknowledge Health Check".
        return send(200, {
          ok: true,
          triggeredAt: new Date().toISOString(),
          environment: body.environment ?? "QA",
          executionId: "9128",
          services: [],
          message: "Health check request accepted. Monitoring workflow will be triggered.",
        });
      }
      if (path === "settings-write") {
        // Mirrors "API 10c - Build API Response".
        const updated = ["responseTimeThresholdMs", "retryCount", "retryDelayMs"].filter((key) => key in body);
        return send(200, {
          success: true,
          message: `${updated.length} settings updated successfully`,
          updatedCount: updated.length,
          settings: updated.map((key) => ({ key, value: body[key] })),
        });
      }
      if (path === "incidents-resolve") {
        // Mirrors "API 11c - Respond incidents-resolve".
        return send(200, {
          success: true,
          message: "Incident resolved successfully",
          incidentId: body.incidentId ?? "",
          status: "RESOLVED",
          recoveryTime: sheetTimestamp(0),
          downtimeSeconds: 372,
          workflowExecutionId: "9129",
        });
      }
      return send(404, { error: `Unknown POST path: ${path}` });
    });
    return;
  }

  const handler = ROUTES[path];
  console.log(`${request.method} /webhook/${path}${url.search}`);
  if (!handler) return send(404, { error: `Unknown path: ${path}` });
  return send(200, handler());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`n8n stub listening on http://127.0.0.1:${PORT}/webhook`);
  console.log("Endpoints:", Object.keys(ROUTES).join(", "));
});
