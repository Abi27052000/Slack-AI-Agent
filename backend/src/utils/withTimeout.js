export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
  }
}

/**
 * Runs `fn(signal)` with a deadline. On timeout the signal is aborted (so in-flight fetches are
 * cancelled) and the promise rejects with TimeoutError, even if `fn` ignores the signal.
 */
export async function withTimeout(fn, ms, label = 'operation') {
  const controller = new AbortController();
  let timer;

  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new TimeoutError(`${label} timed out after ${ms}ms`);
      // Reject first: abort listeners run synchronously, and one that resolves `fn` must not win the race.
      reject(error);
      controller.abort(error);
    }, ms);
  });

  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
