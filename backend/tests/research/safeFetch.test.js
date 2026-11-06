import { describe, it, expect, vi } from 'vitest';
import { assertPublicHost, isPrivateIp, safeFetchText } from '../../src/utils/safeFetch.js';
import { fakeFetch, html, publicLookup, redirect } from './helpers.js';

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip'])(
    'blocks %s',
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('assertPublicHost', () => {
  it.each(['localhost', '127.0.0.1', 'intranet', 'printer.local', 'db.internal', '[::1]', 'bad_host.com'])(
    'rejects %s without a DNS lookup',
    async (host) => {
      const lookupFn = vi.fn();
      await expect(assertPublicHost(host, { lookupFn })).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
      expect(lookupFn).not.toHaveBeenCalled();
    },
  );

  it('rejects public-looking names that resolve to private IPs', async () => {
    const lookupFn = async () => [{ address: '10.0.0.5', family: 4 }];
    await expect(assertPublicHost('evil.example.com', { lookupFn })).rejects.toMatchObject({
      code: 'HOST_NOT_ALLOWED',
    });
  });

  it('reports DNS failures', async () => {
    const lookupFn = async () => {
      throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    };
    await expect(assertPublicHost('nope.example', { lookupFn })).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });

  it('accepts public hosts', async () => {
    await expect(assertPublicHost('acme.io', { lookupFn: publicLookup })).resolves.toBeUndefined();
  });
});

describe('safeFetchText', () => {
  it('fetches https pages', async () => {
    const fetchFn = fakeFetch({ 'https://acme.io/': () => html('<title>Acme</title>') });
    const page = await safeFetchText('https://acme.io', { fetchFn, lookupFn: publicLookup });
    expect(page).toMatchObject({ url: 'https://acme.io/', status: 200, text: '<title>Acme</title>' });
  });

  it('refuses plain http', async () => {
    await expect(
      safeFetchText('http://acme.io', { fetchFn: vi.fn(), lookupFn: publicLookup }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_NOT_ALLOWED' });
  });

  it('follows redirects but re-checks every hop', async () => {
    const fetchFn = fakeFetch({
      'https://acme.io/': () => redirect('https://www.acme.io/home'),
      'https://www.acme.io/home': () => html('ok'),
    });
    const page = await safeFetchText('https://acme.io', { fetchFn, lookupFn: publicLookup });
    expect(page.url).toBe('https://www.acme.io/home');

    const toInternal = fakeFetch({ 'https://acme.io/': () => redirect('https://localhost/admin') });
    await expect(safeFetchText('https://acme.io', { fetchFn: toInternal, lookupFn: publicLookup })).rejects.toMatchObject({
      code: 'HOST_NOT_ALLOWED',
    });
  });

  it('refuses redirects that downgrade to http', async () => {
    const fetchFn = fakeFetch({ 'https://acme.io/': () => redirect('http://acme.io/') });
    await expect(safeFetchText('https://acme.io', { fetchFn, lookupFn: publicLookup })).rejects.toMatchObject({
      code: 'PROTOCOL_NOT_ALLOWED',
    });
  });

  it('stops after too many redirects', async () => {
    const fetchFn = fakeFetch({ 'https://acme.io/': () => redirect('https://acme.io/') });
    await expect(
      safeFetchText('https://acme.io', { fetchFn, lookupFn: publicLookup, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
  });

  it('caps the body size', async () => {
    const fetchFn = fakeFetch({ 'https://acme.io/': () => html('x'.repeat(10_000)) });
    const page = await safeFetchText('https://acme.io', { fetchFn, lookupFn: publicLookup, maxBytes: 100 });
    expect(page.text).toHaveLength(100);
  });

  it('aborts slow responses', async () => {
    const fetchFn = vi.fn(
      (url, { signal }) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );
    await expect(
      safeFetchText('https://acme.io', { fetchFn, lookupFn: publicLookup, timeoutMs: 20 }),
    ).rejects.toThrow();
  });
});
