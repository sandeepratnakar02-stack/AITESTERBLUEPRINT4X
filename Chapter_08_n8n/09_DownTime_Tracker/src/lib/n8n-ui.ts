/**
 * Client-safe n8n deep links.
 *
 * The browser never calls n8n directly (see `lib/n8n.ts`), but it does need a
 * link to the n8n editor for "Open n8n Execution". Only the *UI* base URL is
 * public; the webhook base URL and API key stay server-side.
 *
 *   NEXT_PUBLIC_N8N_UI_URL=https://n8n.example.com
 */
const N8N_UI_URL = (process.env.NEXT_PUBLIC_N8N_UI_URL ?? "").replace(/\/+$/, "");

export const N8N_UI_CONFIGURED = N8N_UI_URL.length > 0;

/**
 * Deep link to an n8n execution, or to the workflow list when no execution id
 * is known. Returns `null` when `NEXT_PUBLIC_N8N_UI_URL` is not set, so callers
 * can disable the button instead of opening a dead link.
 */
export function n8nUiUrl(executionId?: string | null): string | null {
  if (!N8N_UI_CONFIGURED) return null;
  if (executionId) return `${N8N_UI_URL}/execution/${encodeURIComponent(executionId)}`;
  return `${N8N_UI_URL}/home/workflows`;
}
