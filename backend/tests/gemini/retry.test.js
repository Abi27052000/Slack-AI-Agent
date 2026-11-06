import { describe, it, expect, vi } from 'vitest';
import { backoffDelay, retry } from '../../src/utils/retry.js';

const noSleep = vi.fn(async () => {});

describe('retry', () => {
  it('returns the value and attempt count on success', async () => {
    await expect(retry(async () => 'ok', { sleep: noSleep })).resolves.toEqual({ value: 'ok', attempts: 1 });
  });

  it('retries retryable errors until success', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockResolvedValue('ok');
    const onRetry = vi.fn();

    const result = await retry(fn, { retries: 3, sleep: noSleep, onRetry, random: () => 1 });

    expect(result).toEqual({ value: 'ok', attempts: 3 });
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(3, 3);
    expect(onRetry.mock.calls.map(([info]) => info.delayMs)).toEqual([500, 1000]);
  });

  it('stops immediately on non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(retry(fn, { shouldRetry: () => false, sleep: noSleep })).rejects.toMatchObject({
      message: 'fatal',
      attempts: 1,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still failing'));
    await expect(retry(fn, { retries: 2, sleep: noSleep })).rejects.toMatchObject({ attempts: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honours a server-suggested delay', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue('ok');
    await retry(fn, { sleep, retryAfterMs: () => 7_000 });
    expect(sleep).toHaveBeenCalledWith(7_000);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const opts = { baseDelayMs: 500, maxDelayMs: 4_000, random: () => 1 };
    expect([0, 1, 2, 3, 4].map((a) => backoffDelay(a, opts))).toEqual([500, 1000, 2000, 4000, 4000]);
  });

  it('applies full jitter', () => {
    expect(backoffDelay(3, { baseDelayMs: 500, maxDelayMs: 8_000, random: () => 0.5 })).toBe(2000);
  });
});
