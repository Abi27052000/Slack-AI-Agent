import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Outbound HTTP for URLs derived from user-controlled data (e.g. a member's email domain).
 * Guards against SSRF (requests to localhost / internal networks), huge responses and slow servers.
 *
 * Limitation: DNS is resolved once for the check and again by fetch itself, so a DNS-rebinding
 * attacker could still race it. Acceptable for fetching public homepage metadata.
 */

export class SafeFetchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

const blocked = new BlockList();
// IPv4: "this" network, private, CGNAT, loopback, link-local, IETF, benchmarking, multicast, reserved
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
// IPv6: unspecified, loopback, unique-local, link-local, multicast
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateIp(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); // IPv4-mapped IPv6
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = isIP(ip);
  if (family === 0) return true; // not an IP at all: refuse
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Throws unless `hostname` is a public DNS name that resolves only to public addresses. */
export async function assertPublicHost(hostname, { lookupFn = lookup } = {}) {
  if (isIP(hostname) || !HOSTNAME_RE.test(hostname) || /(^|\.)(localhost|local|internal)$/i.test(hostname)) {
    throw new SafeFetchError(`Refusing to fetch non-public host "${hostname}"`, 'HOST_NOT_ALLOWED');
  }

  let addresses;
  try {
    addresses = await lookupFn(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SafeFetchError(`DNS lookup failed for ${hostname}: ${err.code ?? err.message}`, 'DNS_FAILED');
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new SafeFetchError(`Host "${hostname}" resolves to a private address`, 'HOST_NOT_ALLOWED');
  }
}

/** Reads at most `maxBytes` of a response body as UTF-8 text. */
async function readCapped(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

/**
 * GET an https URL with SSRF checks on every redirect hop.
 * @returns {Promise<{ url: string, status: number, contentType: string, text: string }>}
 */
export async function safeFetchText(
  url,
  {
    signal,
    timeoutMs = 5_000,
    maxBytes = 512 * 1024,
    maxRedirects = 3,
    headers = {},
    fetchFn = fetch,
    lookupFn = lookup,
  } = {},
) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let current = new URL(url);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (current.protocol !== 'https:') {
      throw new SafeFetchError(`Only https URLs are allowed (got ${current.protocol})`, 'PROTOCOL_NOT_ALLOWED');
    }
    await assertPublicHost(current.hostname, { lookupFn });

    const response = await fetchFn(current, {
      method: 'GET',
      redirect: 'manual',
      signal: combinedSignal,
      headers: { 'User-Agent': 'AI-Slack-Agent/1.0 (+member research)', Accept: 'text/html', ...headers },
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel().catch(() => {});
      current = new URL(response.headers.get('location'), current);
      continue;
    }

    return {
      url: current.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      text: await readCapped(response, maxBytes),
    };
  }

  throw new SafeFetchError(`Too many redirects (>${maxRedirects})`, 'TOO_MANY_REDIRECTS');
}
