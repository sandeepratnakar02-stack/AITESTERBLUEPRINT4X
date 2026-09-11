"use client";

import * as React from "react";
import { Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchSettings, saveSettings } from "@/lib/client-api";
import { CHECK_INTERVAL_OPTIONS } from "@/lib/constants";
import type { DashboardSettings, Environment, EnvironmentConfig } from "@/types";

const ATTEMPT_OPTIONS = [1, 2, 3, 4, 5];

function LoadingState() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardHeader>
            <div className="h-4 w-40 animate-pulse-soft rounded bg-muted" />
            <div className="h-3 w-64 animate-pulse-soft rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="h-9 w-full animate-pulse-soft rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Settings form bound to the n8n workflow configuration (mock-backed for now). */
export function SettingsForm() {
  const [settings, setSettings] = React.useState<DashboardSettings | null>(null);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = React.useCallback((changes: Partial<DashboardSettings>) => {
    setSettings((current) => (current ? { ...current, ...changes } : current));
    setStatus("idle");
  }, []);

  const patchEnvironment = (environment: Environment, changes: Partial<EnvironmentConfig>) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            environments: current.environments.map((item) =>
              item.environment === environment ? { ...item, ...changes } : item,
            ),
          }
        : current,
    );
    setStatus("idle");
  };

  const handleAttemptsChange = (attempts: number) => {
    setSettings((current) => {
      if (!current) return current;
      const delays = Array.from({ length: Math.max(0, attempts - 1) }, (_, index) => {
        if (current.retryDelaysSeconds[index] !== undefined) return current.retryDelaysSeconds[index];
        return index === 0 ? 20 : 30;
      });
      return { ...current, retryAttempts: attempts, retryDelaysSeconds: delays };
    });
    setStatus("idle");
  };

  const handleSave = async () => {
    if (!settings) return;
    setStatus("saving");
    setError(null);
    try {
      await saveSettings(settings);
      setStatus("saved");
    } catch (caught) {
      setStatus("idle");
      setError((caught as Error).message);
    }
  };

  const handleReset = async () => {
    setStatus("saving");
    setError(null);
    try {
      setSettings(await fetchSettings());
      setStatus("idle");
    } catch (caught) {
      setStatus("idle");
      setError((caught as Error).message);
    }
  };

  if (error && !settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!settings) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Health Check Thresholds</CardTitle>
          <CardDescription>
            Applied by the n8n workflow when classifying SLOW vs HEALTHY results.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="response-threshold">Response Time Threshold (ms)</Label>
            <Input
              id="response-threshold"
              type="number"
              min={100}
              step={100}
              value={settings.responseTimeThresholdMs}
              onChange={(event) => patch({ responseTimeThresholdMs: Number(event.target.value) })}
            />
            <p className="text-2xs text-muted-foreground">
              Checks slower than this are reported as SLOW (Degraded).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="check-interval">Check Interval</Label>
            <Select
              id="check-interval"
              value={settings.checkIntervalMinutes}
              onChange={(event) => patch({ checkIntervalMinutes: Number(event.target.value) })}
            >
              {CHECK_INTERVAL_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 1 ? "1 minute" : `${minutes} minutes`}
                </option>
              ))}
            </Select>
            <p className="text-2xs text-muted-foreground">
              Frequency of the n8n schedule trigger.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retry Policy</CardTitle>
          <CardDescription>
            Number of attempts and the wait time applied before each retry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="retry-attempts">Retry Attempts</Label>
            <Select
              id="retry-attempts"
              value={settings.retryAttempts}
              onChange={(event) => handleAttemptsChange(Number(event.target.value))}
            >
              {ATTEMPT_OPTIONS.map((attempts) => (
                <option key={attempts} value={attempts}>
                  {attempts}
                </option>
              ))}
            </Select>
            <p className="text-2xs text-muted-foreground">
              1 initial check plus {Math.max(0, settings.retryAttempts - 1)} automatic retries.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {settings.retryDelaysSeconds.map((delay, index) => (
              <div key={`delay-${index + 2}`} className="space-y-1.5">
                <Label htmlFor={`delay-${index + 2}`}>Attempt {index + 2} Delay (seconds)</Label>
                <Input
                  id={`delay-${index + 2}`}
                  type="number"
                  min={1}
                  step={5}
                  value={delay}
                  onChange={(event) => {
                    const next = [...settings.retryDelaysSeconds];
                    next[index] = Number(event.target.value);
                    patch({ retryDelaysSeconds: next });
                  }}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment Configuration</CardTitle>
          <CardDescription>Base URLs and monitoring scope per environment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings.environments.map((config) => (
            <div
              key={config.environment}
              className="grid items-end gap-3 rounded-md border border-border bg-muted/20 p-3 lg:grid-cols-[8rem_1fr_9rem_auto]"
            >
              <div className="space-y-1.5">
                <Label>Environment</Label>
                <p className="text-xs font-medium">{config.environment}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`base-url-${config.environment}`}>Base URL</Label>
                <Input
                  id={`base-url-${config.environment}`}
                  value={config.baseUrl}
                  onChange={(event) =>
                    patchEnvironment(config.environment, { baseUrl: event.target.value })
                  }
                  className="font-mono text-2xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`criticality-${config.environment}`}>Criticality</Label>
                <Select
                  id={`criticality-${config.environment}`}
                  value={config.criticality}
                  onChange={(event) =>
                    patchEnvironment(config.environment, {
                      criticality: event.target.value as EnvironmentConfig["criticality"],
                    })
                  }
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                </Select>
              </div>

              <div className="flex items-center gap-2 pb-1">
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) =>
                    patchEnvironment(config.environment, { enabled: checked })
                  }
                  aria-label={`Enable monitoring for ${config.environment}`}
                />
                <span className="text-xs text-muted-foreground">
                  {config.enabled ? "Monitored" : "Paused"}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
          {status === "saved" ? "Saved" : "Save Settings"}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={status === "saving"}>
          <RotateCcw />
          Reset to defaults
        </Button>
        {status === "saved" ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-status-healthy-strong">
            <ShieldCheck className="size-3.5" aria-hidden />
            Configuration saved
          </span>
        ) : error ? (
          <span className="text-xs font-medium text-status-down-strong">{error}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Saved through <code className="font-mono text-2xs">/api/settings</code> → the n8n settings
            webhook.
          </span>
        )}
      </div>
    </div>
  );
}
