import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { normalizeEnvironment } from "@/lib/environment";

export const dynamic = "force-dynamic";

/** Allows a cold n8n instance to wake up before the platform kills the request. */
export const maxDuration = 60;

/**
 * `GET /api/dashboard?environment=QA`
 *
 * Single aggregated endpoint behind the dashboard. Replaces the previous fan-out
 * of 5 upstream n8n webhooks with one request from the client, resolved
 * server-side with capped concurrency and per-source deadlines.
 *
 * Status semantics:
 *
 *   200 — the snapshot was produced and at least one source responded. Partial
 *         failures are reported in `ok` / `sources` / `warnings` so the UI can
 *         render a degraded state instead of falling back to mock data.
 *   503 — **every** live source failed (`warnings.length === sources.length`).
 *         The body is still the structured `{ ok, warnings, snapshot }` envelope
 *         so a caller can tell "the backend is down" from "nothing to report".
 *   500 — the snapshot could not be assembled at all.
 *
 * Mock mode never yields 503: with `USE_LIVE_DATA` off there is no upstream to
 * be unavailable, so mock responses are always 200.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const environment = normalizeEnvironment(params.get("environment") ?? params.get("env"));

  try {
    const snapshot = await getDashboardSnapshot(environment);

    const allSourcesFailed =
      snapshot.source === "live" &&
      snapshot.sources.length > 0 &&
      snapshot.warnings.length === snapshot.sources.length;

    if (allSourcesFailed) {
      return NextResponse.json(
        { ok: false, warnings: snapshot.warnings, snapshot },
        { status: 503 },
      );
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        warnings: [(error as Error).message ?? "Failed to build the dashboard snapshot"],
        environment,
      },
      { status: 500 },
    );
  }
}
