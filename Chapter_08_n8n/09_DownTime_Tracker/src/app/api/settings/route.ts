import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/api";
import type { DashboardSettings } from "@/types";

export const dynamic = "force-dynamic";

/**
 * `GET /api/settings` — current threshold / retry / environment configuration.
 * `POST /api/settings` — persist it through the n8n `POST /settings-write` webhook.
 *
 * Same-origin so the settings form never needs the n8n base URL.
 */

export async function GET() {
  try {
    return NextResponse.json(await getSettings());
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "Unable to load settings" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let payload: DashboardSettings;

  try {
    payload = (await request.json()) as DashboardSettings;
  } catch {
    return NextResponse.json({ error: "A JSON settings body is required" }, { status: 400 });
  }

  try {
    const saved = await updateSettings(payload);
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "Unable to save settings" },
      { status: 502 },
    );
  }
}
