import { describe, it, expect, vi, afterEach } from 'vitest';
import prisma, { checkDatabase, connectDatabase, describeDbError } from '../src/lib/prisma.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkDatabase', () => {
  it('returns true when the probe query succeeds', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
    await expect(checkDatabase()).resolves.toBe(true);
  });

  it('returns false instead of throwing when the database is down', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(checkDatabase()).resolves.toBe(false);
  });
});

describe('connectDatabase', () => {
  it('retries until the database becomes reachable', async () => {
    vi.spyOn(prisma, '$connect').mockResolvedValue();
    const query = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('starting up'))
      .mockResolvedValue([]);

    await connectDatabase({ retries: 3, delayMs: 1 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    vi.spyOn(prisma, '$connect').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(connectDatabase({ retries: 2, delayMs: 1 })).rejects.toThrow(
      'Could not connect to the database: ECONNREFUSED',
    );
  });
});

describe('describeDbError', () => {
  it('falls back to the error code when Prisma leaves the message empty', () => {
    const err = Object.assign(new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n\n'), {
      code: 'ECONNREFUSED',
    });
    expect(describeDbError(err)).toBe('ECONNREFUSED');
  });

  it('combines code and message when both exist', () => {
    const err = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    expect(describeDbError(err)).toBe('28P01: password authentication failed');
  });
});
