"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChevronLeft,
  LayoutDashboard,
  RotateCcw,
  ScrollText,
  Server,
  Settings,
  Shapes,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME, NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Environment } from "@/types";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Server,
  Activity,
  TriangleAlert,
  Timer,
  RotateCcw,
  ScrollText,
  Settings,
};

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  environment: Environment;
}

export function Sidebar({ collapsed, onToggle, environment }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 md:flex",
        collapsed ? "w-[4.25rem]" : "w-60",
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          V
        </span>
        {!collapsed ? (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold tracking-tight">{APP_NAME.split(" ")[0]}</p>
            <p className="truncate text-2xs text-muted-foreground">QA Downtime Tracker</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            collapsed && "absolute left-[3.35rem] top-5 hidden",
          )}
        >
          <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3 scrollbar-thin">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={`${item.href}?env=${environment}`}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")}
                aria-hidden
              />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
              {active && !collapsed ? (
                <span className="ml-auto size-1.5 rounded-full bg-status-info" aria-hidden />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        {!collapsed ? (
          <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              QA Environment
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium">
              <span className="size-1.5 rounded-full bg-status-healthy" aria-hidden />
              {environment} · Operational
            </p>
          </div>
        ) : null}

        <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-2xs font-semibold text-foreground">
            QA
          </span>
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium">QA Engineer</p>
              <p className="truncate text-2xs text-muted-foreground">Personal workspace</p>
            </div>
          ) : null}
          {!collapsed ? (
            <Shapes className="ml-auto size-3.5 text-muted-foreground/60" aria-hidden />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
