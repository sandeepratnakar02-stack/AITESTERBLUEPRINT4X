"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PanelLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EnvironmentSelector } from "@/components/layout/environment-selector";
import { APPLICATION, MOCK_NOW } from "@/lib/constants";
import { triggerHealthCheck } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Environment } from "@/types";

const AUTO_REFRESH_INTERVAL_MS = 60_000;

export interface TopBarProps {
  environment: Environment;
  onToggleSidebar: () => void;
}

/**
 * Global toolbar: environment + application context, manual/auto refresh and the
 * "Run Health Check" trigger that posts to the n8n `/health-check` webhook.
 */
export function TopBar({ environment, onToggleSidebar }: TopBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [isRunning, setIsRunning] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [lastCheckedAt, setLastCheckedAt] = React.useState<string>(MOCK_NOW.toISOString());
  const [notice, setNotice] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    startTransition(() => router.refresh());
    setLastCheckedAt(new Date().toISOString());
  }, [router]);

  // Auto refresh — re-fetches the current route once per minute while enabled.
  React.useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleRunHealthCheck = async () => {
    setIsRunning(true);
    try {
      // Same-origin route -> n8n. React 19 StrictMode-safe: the request is
      // idempotent from the user's perspective (a check run is repeatable).
      const result = await triggerHealthCheck(environment);
      setNotice(result.message ?? `Health check queued • ${result.executionId}`);
      refresh();
    } catch (error) {
      setNotice(
        `Health check failed to trigger — ${(error as Error).message ?? "check the n8n webhook URL"}`,
      );
    } finally {
      setIsRunning(false);
    }
  };

  const busy = isPending || isRunning;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="md:hidden"
        >
          <PanelLeft />
        </Button>

        {/* Context selectors */}
        <div className="flex items-center gap-3">
          <EnvironmentSelector environment={environment} />
          <div className="flex items-center gap-2">
            <span className="hidden text-2xs font-semibold uppercase tracking-wide text-muted-foreground lg:block">
              Application
            </span>
            <Select
              aria-label="Application"
              defaultValue={APPLICATION}
              className="h-8 w-[5.5rem] text-xs font-medium"
            >
              <option value="VWO">VWO</option>
            </Select>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Meta */}
          <div className="flex flex-col items-end leading-tight">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Last Checked
            </span>
            <span className="text-xs font-medium tabular">{formatDateTime(lastCheckedAt)}</span>
          </div>

          <div className="hidden items-center gap-2 border-l border-border pl-4 lg:flex">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Auto Refresh
            </span>
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              aria-label="Auto refresh"
            />
            <span
              className={cn(
                "text-xs font-semibold",
                autoRefresh ? "text-status-healthy-strong" : "text-muted-foreground",
              )}
            >
              {autoRefresh ? "ON" : "OFF"}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 border-l border-border pl-4">
            <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
              <RefreshCw className={cn(isPending && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={handleRunHealthCheck} disabled={busy}>
              {isRunning ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Run Health Check
            </Button>
          </div>
        </div>
      </div>

      {notice ? (
        <div className="flex items-center gap-2 border-t border-status-info-border bg-status-info-soft px-4 py-1.5 text-xs text-status-info-strong md:px-6">
          <CheckCircle2 className="size-3.5" aria-hidden />
          {notice}
        </div>
      ) : null}
    </header>
  );
}
