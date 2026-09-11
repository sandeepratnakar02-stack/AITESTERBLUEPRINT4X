import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Real-time availability, functional health and response time monitoring for VWO QA services.",
};

/** The dashboard always reflects live n8n data, so it is never statically cached. */
export const dynamic = "force-dynamic";

/**
 * Serverless execution budget.
 *
 * A cold dashboard fans out to 4-5 n8n webhooks and has been measured at ~13 s
 * while the n8n Cloud instance wakes up, which exceeds the default platform
 * limit (10 s on Vercel) and would 504. Keep this comfortably **above**
 * `N8N_TIMEOUT_MS` so the app's own timeout and mock fallback always win.
 * Applies to every route beneath this layout.
 */
export const maxDuration = 60;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
