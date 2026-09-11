import { NextResponse } from "next/server";
import { n8nFetch } from "@/lib/n8n";
import { normalizeIncident, toArray } from "@/lib/normalize";
import { normalizeEnvironment } from "@/lib/environment";

export const dynamic = "force-dynamic";

/** Allows a cold n8n instance to wake up before the platform kills the request. */
export const maxDuration = 60;

/**
 * `GET /api/incidents`
 *
 * Live incident feed for the dashboard. Unlike the page data layer this always
 * calls n8n (it is an explicit "give me the real thing" endpoint) and returns
 * **normalised** incidents, so the payload can be fed straight into the UI:
 * `incidentId → id`, `SEV-3 → Medium`, `OPEN → Open`, sheet timestamps → ISO.
 *
 * Query parameters:
 *   ?environment=QA    (default QA) — also accepts ?env=
 *   ?id=INC-…          return a single incident
 *
 * Uses the shared transport, so it honours `N8N_INCIDENTS_URL` when that
 * override is configured and otherwise falls back to
 * `N8N_BASE_URL` + `N8N_WEBHOOK_PATH`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const environment = normalizeEnvironment(params.get("environment") ?? params.get("env"));
  const id = params.get("id")?.trim() || undefined;

  try {
    const payload = await n8nFetch<unknown>("/incidents", { query: { environment, id } });

    const incidents = toArray<unknown>(payload, "incidents")
      .map(normalizeIncident)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    return NextResponse.json({
      success: true,
      environment,
      count: incidents.length,
      activeIncidents: incidents.filter(
        (incident) => incident.status === "Open" || incident.status === "Investigating",
      ).length,
      incidents,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: (error as Error).message ?? "Failed to fetch incidents from n8n",
      },
      { status: 502 },
    );
  }
}
