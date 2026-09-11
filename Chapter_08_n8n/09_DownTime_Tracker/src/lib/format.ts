import { MOCK_NOW } from "@/lib/constants";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Missing/invalid timestamps render as an em dash instead of "NaN:NaN". */
export const EMPTY = "—";

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parses a timestamp from any producer. Google Sheets rows use
 * `"2026-09-10 15:28:49"` (no timezone); n8n payloads usually use ISO strings.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const date = new Date(raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `10:42 AM` */
export function formatTime(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return EMPTY;
  const suffix = d.getHours() >= 12 ? "PM" : "AM";
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${suffix}`;
}

/** `10 Sep 2026 • 10:42 AM` */
export function formatDateTime(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return EMPTY;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} • ${formatTime(iso)}`;
}

/** `10 Sep 2026` */
export function formatDate(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return EMPTY;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `Thu` — used as the uptime chart axis label. */
export function formatWeekday(iso?: string | null): string {
  const d = parseDate(iso);
  return d ? WEEKDAYS[d.getDay()] : EMPTY;
}

/** `09 Sep` */
export function formatDayMonth(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return EMPTY;
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;
}

/** `724 ms` / `3.4 sec` */
export function formatResponseTime(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} sec`;
  return `${Math.round(ms)} ms`;
}

/** `6m 21s` */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return EMPTY;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** `99.96%` */
export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return EMPTY;
  return `${value.toFixed(digits)}%`;
}

/**
 * Relative label anchored to the dashboard snapshot: `10:36 AM`, `Yesterday`,
 * `08 Sep`.
 */
export function formatRelative(iso?: string | null, now: Date = MOCK_NOW): string {
  const then = parseDate(iso);
  if (!then) return EMPTY;

  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = diffMs / 60000;

  if (diffMinutes < 1 && diffMinutes > -1) return "Just now";
  if (diffMinutes >= 1 && diffMinutes < 60) return `${Math.floor(diffMinutes)}m ago`;

  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return formatTime(iso);

  const dayDiff = Math.floor(diffMs / 86400000);
  if (dayDiff < 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff}d ago`;
  return formatDayMonth(iso);
}

/** `10:42:07` — second-level precision used in the log viewer / retry timeline. */
export function formatClockWithSeconds(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return EMPTY;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** ISO timestamp for the mock dataset, offset from the snapshot instant. */
export function offsetFromNow(secondsAgo: number): string {
  return new Date(MOCK_NOW.getTime() - secondsAgo * 1000).toISOString();
}
