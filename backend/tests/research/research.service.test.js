import { describe, it, expect, vi } from 'vitest';
import { buildResearchContext, defaultProviders, researchMember } from '../../src/services/research.service.js';

const source = (provider) => ({ provider, type: 'test', url: `https://${provider}.test`, title: provider });

const provider = (name, run, skipReason = () => null) => ({ name, run: vi.fn(run), skipReason });

describe('buildResearchContext', () => {
  it('derives domain and personal-email flag', () => {
    expect(buildResearchContext({ name: ' Jane Doe ', email: 'Jane@Acme.io' })).toEqual({
      name: 'Jane Doe',
      email: 'Jane@Acme.io',
      domain: 'acme.io',
      isPersonalEmail: false,
    });
    expect(buildResearchContext({ email: 'jane@gmail.com' }).isPersonalEmail).toBe(true);
    expect(buildResearchContext({})).toEqual({ name: null, email: null, domain: null, isPersonalEmail: false });
  });
});

describe('default provider rules', () => {
  const company = defaultProviders.find((p) => p.name === 'company_website');
  const github = defaultProviders.find((p) => p.name === 'github');

  it('skips company research for personal or missing emails', () => {
    expect(company.skipReason(buildResearchContext({ email: 'x@gmail.com' }))).toBe('personal email domain');
    expect(company.skipReason(buildResearchContext({ name: 'X' }))).toBe('no email');
    expect(company.skipReason(buildResearchContext({ email: 'x@acme.io' }))).toBeNull();
  });

  it('runs GitHub research for personal emails too (unlike the reference project)', () => {
    expect(github.skipReason(buildResearchContext({ email: 'x@gmail.com' }))).toBeNull();
    expect(github.skipReason(buildResearchContext({}))).toBe('no email or name');
  });
});

describe('researchMember', () => {
  const member = { name: 'Jane Doe', email: 'jane@acme.io' };

  it('collects sources from all providers in parallel', async () => {
    const providers = [provider('a', async () => source('a')), provider('b', async () => source('b'))];
    const result = await researchMember(member, { providers, timeoutMs: 1_000 });

    expect(result.sources.map((s) => s.provider)).toEqual(['a', 'b']);
    expect(result).toMatchObject({ skipped: [], errors: [] });
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(providers[0].run).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'acme.io' }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it('records skipped providers without running them', async () => {
    const skippedProvider = provider('skip-me', async () => source('x'), () => 'not applicable');
    const result = await researchMember(member, { providers: [skippedProvider] });

    expect(result.skipped).toEqual([{ provider: 'skip-me', reason: 'not applicable' }]);
    expect(skippedProvider.run).not.toHaveBeenCalled();
  });

  it('omits providers that found nothing', async () => {
    const result = await researchMember(member, { providers: [provider('empty', async () => null)] });
    expect(result.sources).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('never throws: failures and timeouts become error entries', async () => {
    const providers = [
      provider('ok', async () => source('ok')),
      provider('broken', async () => {
        throw Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED' });
      }),
      provider('slow', (ctx, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(source('late'))))),
      provider('hangs', () => new Promise(() => {})), // ignores the abort signal entirely
    ];

    const result = await researchMember(member, { providers, timeoutMs: 30 });

    expect(result.sources.map((s) => s.provider)).toEqual(['ok']);
    expect(result.errors).toEqual([
      { provider: 'broken', code: 'RATE_LIMITED', message: 'rate limited' },
      { provider: 'slow', code: 'TIMEOUT', message: 'slow research timed out after 30ms' },
      { provider: 'hangs', code: 'TIMEOUT', message: 'hangs research timed out after 30ms' },
    ]);
  });
});
