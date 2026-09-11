import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/api";
import { normalizeEnvironment } from "@/lib/environment";

export const dynamic = "force-dynamic";

/**
 * `POST /api/health-check`
 *
 * Same-origin proxy so the browser can trigger a check without CORS and without
 * ever seeing the n8n webhook URL or API key. Forwards to the n8n
 * `POST /health-check` webhook, which acknowledges immediately and then runs the
 * monitoring workflow.
 */
export async function POST(request: Request) {
  let environment = normalizeEnvironment(undefined);

  try {
    const body = (await request.json()) as { environment?: string } | null;
    environment = normalizeEnvironment(body?.environment);
  } catch {
    // No/invalid JSON body — fall back to QA.
  }

  try {
    const result = await runHealthCheck(environment);
    return NextResponse.json({
      ...result,
      message: `Health check queued for ${environment} • ${result.executionId}`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message ?? "Unable to trigger the health check" },
      { status: 502 },
    );
  }
}
