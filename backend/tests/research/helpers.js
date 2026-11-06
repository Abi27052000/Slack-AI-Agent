import { vi } from 'vitest';

/** DNS stub: every hostname resolves to a public address unless overridden. */
export const publicLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

/**
 * Builds a fake `fetch` from a route table: { 'https://acme.io/': () => Response }.
 * Unknown URLs throw like a network failure.
 */
export function fakeFetch(routes) {
  return vi.fn(async (input) => {
    const url = input.toString();
    const route = routes[url];
    if (!route) throw new TypeError(`fetch failed: no route for ${url}`);
    return route();
  });
}

export const html = (body, init = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

export const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

export const redirect = (location, status = 301) =>
  new Response(null, { status, headers: { location } });
