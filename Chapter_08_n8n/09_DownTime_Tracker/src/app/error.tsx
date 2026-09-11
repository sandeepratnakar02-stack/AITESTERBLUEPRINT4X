"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Route-level error boundary.
 *
 * In live mode the data layer deliberately does **not** substitute mock data when
 * an n8n call fails, so the failure surfaces here as an explicit error state
 * instead of a dashboard that looks healthy but shows sample numbers.
 * The dashboard itself is served by `/api/dashboard`, which degrades partially
 * rather than throwing, so it will rarely reach this boundary.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-status-down" aria-hidden />
            Live data unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The monitoring backend could not be reached, so this view was not rendered with sample
            data. Check that the n8n API workflow is active and that{" "}
            <code className="font-mono text-2xs">N8N_BASE_URL</code> points at your instance.
          </p>

          <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-2xs text-muted-foreground scrollbar-thin">
            {error.message}
          </pre>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={reset}>
              <RefreshCw />
              Retry
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
