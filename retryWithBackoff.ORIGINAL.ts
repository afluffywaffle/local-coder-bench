// Retry an async operation with exponential backoff.
// Pure logic (no real timers assumed by callers): uses setTimeout so tests
// can drive it with fake timers.

export interface BackoffOptions {
  /** total number of attempts (>= 1). The first try counts as attempt 1. */
  attempts: number;
  /** base delay in ms before the 2nd attempt. */
  baseMs: number;
  /** multiplier applied each retry. Default 2. */
  factor?: number;
  /** upper bound on any single delay, in ms. Default Infinity. */
  capMs?: number;
  /** optional abort signal — abort short-circuits with the abort reason. */
  signal?: AbortSignal;
}

/**
 * Call `fn`; if it rejects, wait (exponential backoff) and retry, up to
 * `attempts` total. See retryWithBackoff_spec for exact rules.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: BackoffOptions,
): Promise<T> {
  const { attempts, baseMs, factor = 2, capMs = Infinity, signal } = opts;

  if (signal?.aborted) {
    throw signal.reason ?? new Error("aborted");
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break; // no delay after the final attempt
      const delay = Math.min(capMs, baseMs * Math.pow(factor, attempt - 1));
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason ?? new Error("aborted"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
