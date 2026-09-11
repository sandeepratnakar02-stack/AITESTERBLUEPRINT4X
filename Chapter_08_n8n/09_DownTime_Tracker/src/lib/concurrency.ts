/**
 * Small async helpers for bounding outbound work.
 *
 * The dashboard fans out to several n8n webhooks. Firing them all at once was
 * causing bursts that the n8n instance intermittently refused (every call in the
 * burst failed together), so concurrency is capped and every call carries its
 * own deadline.
 */

/**
 * Creates a scheduler that runs at most `limit` tasks concurrently.
 *
 * A semaphore is used instead of mapping a `worker` over a task array because
 * it keeps each call's return type intact: the caller awaits individually typed
 * promises while the ceiling is still enforced.
 */
export function createLimiter(limit: number) {
  const max = Math.max(1, Math.floor(limit) || 1);
  let active = 0;
  const waiting: Array<() => void> = [];

  function release() {
    active -= 1;
    const resume = waiting.shift();
    if (resume) resume();
  }

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        task().then(resolve, reject).finally(release);
      };

      if (active < max) start();
      else waiting.push(start);
    });
  };
}

/**
 * Rejects if `promise` has not settled within `ms`.
 *
 * Defence in depth on top of `fetch`'s own AbortController: a stalled DNS lookup
 * or socket can outlive an abort, and a serverless function must still answer.
 */
export async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded its ${ms} ms deadline`)), ms);
  });

  // If the deadline wins, the original promise may still reject later; swallow
  // that so it never surfaces as an unhandled rejection.
  promise.catch(() => {});

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
