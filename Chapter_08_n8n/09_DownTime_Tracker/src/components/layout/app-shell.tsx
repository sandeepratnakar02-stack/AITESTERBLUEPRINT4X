"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { normalizeEnvironment } from "@/lib/environment";

const STORAGE_KEY = "vwo-qa-sidebar-collapsed";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const environment = normalizeEnvironment(searchParams.get("env"));

  const [collapsed, setCollapsed] = React.useState(false);

  // Restore the collapsed preference and auto-collapse on tablet-width screens.
  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setCollapsed(stored === "true");
      return;
    }
    setCollapsed(window.innerWidth < 1180);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={toggle} environment={environment} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar environment={environment} onToggleSidebar={toggle} />
        <main className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}

/** Root layout frame: sticky top bar + collapsible left navigation. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <AppShellInner>{children}</AppShellInner>
    </React.Suspense>
  );
}
