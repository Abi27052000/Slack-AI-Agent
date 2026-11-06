const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with "full jitter": a random delay in [0, min(max, base * 2^attempt)]. */
export function backoffDelay(attempt, { baseDelayMs, maxDelayMs, random = Math.random }) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * Calls `fn(attempt)` until it succeeds, `shouldRetry(err)` says no, or retries run out.
 * Rejects with the last error, annotated with `attempts`.
 *
 * @param {(attempt: number) => Promise<any>} fn  attempt is 1-based
 * @param {object} [options]
 * @param {number} [options.retries=3]  retries after the first attempt
 * @param {(err: Error) => boolean} [options.shouldRetry]
 * @param {(info: {attempt: number, delayMs: number, error: Error}) => void} [options.onRetry]
 * @param {(err: Error) => number|undefined} [options.retryAfterMs]  server-suggested delay, if any
 */
export async function retry(
  fn,
  {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    shouldRetry = () => true,
    onRetry,
    retryAfterMs,
    sleep = defaultSleep,
    random,
  } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (error) {
      if (attempt > retries || !shouldRetry(error)) {
        error.attempts = attempt;
        throw error;
      }
      const suggested = retryAfterMs?.(error);
      const delayMs = suggested ?? backoffDelay(attempt - 1, { baseDelayMs, maxDelayMs, random });
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
