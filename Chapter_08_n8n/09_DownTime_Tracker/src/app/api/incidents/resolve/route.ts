import { NextResponse } from "next/server";
import { resolveIncident } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/incidents/resolve`
 *
 * Same-origin proxy for the incident detail page's "Resolve Incident" action.
 * Forwards to the n8n `POST /incidents-resolve` webhook, which flips the
 * `Status` column of the incident row in `Downtime_Incidents` to `RESOLVED`.
 */
export async function POST(request: Request) {
  let incidentId = "";

  try {
    const body = (await request.json()) as { incidentId?: string } | null;
    incidentId = String(body?.incidentId ?? "").trim();
  } catch {
    // fall through to validation below
  }

  if (!incidentId) {
    return NextResponse.json({ ok: false, error: "incidentId is required" }, { status: 400 });
  }

  try {
    const result = await resolveIncident(incidentId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message ?? "Unable to resolve the incident" },
      { status: 502 },
    );
  }
}
