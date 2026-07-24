// Retry an async operation with exponential backoff.
// Uses setTimeout so tests can drive it with fake timers.

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
 * Call `fn(attempt)`; if it rejects, wait (exponential backoff) then retry,
 * up to `attempts` total tries. Resolves with the first success; if every
 * attempt fails, rejects with the LAST error. An aborted signal short-circuits.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: BackoffOptions,
): Promise<T> {
  throw new Error("not implemented");
}
