// --- Date helpers ---

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function daysSince(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// --- URL helpers ---

export function normalizeUrl(url) {
  if (!url) return '';
  const t = url.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isValidHttpUrl(url) {
  try {
    const u = new URL(normalizeUrl(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// --- Sorting ---

export function compareByDate(sortDir) {
  const mul = sortDir === 'oldest' ? 1 : -1;
  return (a, b) => {
    const da = new Date(a.dateApplied || 0).getTime();
    const db = new Date(b.dateApplied || 0).getTime();
    return (da - db) * mul;
  };
}
