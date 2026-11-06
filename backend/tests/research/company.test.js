import { describe, it, expect } from 'vitest';
import { researchCompany } from '../../src/integrations/research/company.js';
import { fakeFetch, html, json, publicLookup } from './helpers.js';

const PAGE = `<title>Acme | Home</title>
  <meta name="description" content="APIs for logistics teams">
  <meta property="og:site_name" content="Acme">`;

const run = (routes, domain = 'acme.io') =>
  researchCompany(domain, { fetchOptions: { fetchFn: fakeFetch(routes), lookupFn: publicLookup } });

describe('researchCompany', () => {
  it('returns company metadata from the homepage', async () => {
    const result = await run({ 'https://acme.io/': () => html(PAGE) });

    expect(result).toEqual({
      provider: 'company_website',
      type: 'company',
      url: 'https://acme.io/',
      title: 'Acme',
      summary: 'APIs for logistics teams',
      confidence: 'high',
      data: {
        domain: 'acme.io',
        pageTitle: 'Acme | Home',
        siteName: 'Acme',
        description: 'APIs for logistics teams',
      },
    });
  });

  it('falls back to www. when the apex domain fails', async () => {
    const result = await run({ 'https://www.acme.io/': () => html(PAGE) });
    expect(result.url).toBe('https://www.acme.io/');
  });

  it('falls back to www. when the apex returns an error page', async () => {
    const result = await run({
      'https://acme.io/': () => html('<title>Not found</title>', { status: 404 }),
      'https://www.acme.io/': () => html(PAGE),
    });
    expect(result.url).toBe('https://www.acme.io/');
  });

  it('ignores non-HTML responses and pages without metadata', async () => {
    expect(
      await run({
        'https://acme.io/': () => json({ hello: 'world' }),
        'https://www.acme.io/': () => html('<body>no head</body>'),
      }),
    ).toBeNull();
  });

  it('throws when the site cannot be reached at all', async () => {
    await expect(run({})).rejects.toThrow(/fetch failed/);
  });

  it('never fetches internal hosts', async () => {
    await expect(run({}, 'localhost')).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });
});
