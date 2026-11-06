import { describe, it, expect } from 'vitest';
import { TimeoutError, withTimeout } from '../../src/utils/withTimeout.js';

describe('withTimeout', () => {
  it('resolves with the result when fast enough', async () => {
    await expect(withTimeout(async () => 'done', 100)).resolves.toBe('done');
  });

  it('rejects with TimeoutError and aborts the signal when too slow', async () => {
    let seenSignal;
    const promise = withTimeout((signal) => {
      seenSignal = signal;
      return new Promise(() => {});
    }, 20, 'lookup');

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toThrow('lookup timed out after 20ms');
    expect(seenSignal.aborted).toBe(true);
  });

  it('passes through errors from the function', async () => {
    await expect(withTimeout(async () => {
      throw new Error('boom');
    }, 100)).rejects.toThrow('boom');
  });
});
