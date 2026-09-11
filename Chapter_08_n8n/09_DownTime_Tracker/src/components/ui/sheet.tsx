"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Rendered in the sticky footer (action buttons). */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** "md" (default 30rem) or "lg" (34rem). */
  size?: "md" | "lg";
}

/**
 * Right-hand drawer used for Health Check details and incident drill-downs.
 * Hand-rolled (no Radix dependency) but keyboard accessible: Escape closes,
 * the overlay is clickable and background scrolling is locked while open.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  size = "md",
}: SheetProps) {
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in cursor-default bg-slate-900/25 backdrop-blur-[1px]"
      />
      <div
        className={cn(
          "relative flex h-full w-full flex-col border-l border-border bg-background shadow-drawer animate-slide-in-right",
          size === "lg" ? "max-w-[34rem]" : "max-w-[30rem]",
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Definition row used inside drawers, detail pages and settings panels. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-6 py-2", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="max-w-[62%] break-words text-right text-xs font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

export function DetailSection({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/70 py-3 last:border-b-0">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <dl className="mt-1 divide-y divide-border/60">{children}</dl>
    </section>
  );
}
