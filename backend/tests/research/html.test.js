import { describe, it, expect } from 'vitest';
import { clean, decodeEntities, extractMetadata } from '../../src/integrations/research/html.js';

describe('extractMetadata', () => {
  it('reads title, description and Open Graph tags', () => {
    const page = `<!doctype html><html><head>
      <title>
        Acme &amp; Co | Home
      </title>
      <meta name="description" content="Developer tools for &quot;fast&quot; teams">
      <meta property='og:site_name' content='Acme'>
      <meta content="Acme — Build faster" property="og:title" />
    </head><body>ignored</body></html>`;

    expect(extractMetadata(page)).toEqual({
      title: 'Acme & Co | Home',
      description: 'Developer tools for "fast" teams',
      siteName: 'Acme',
      ogTitle: 'Acme — Build faster',
      ogDescription: null,
    });
  });

  it('falls back to og:description and handles missing tags', () => {
    expect(extractMetadata('<meta property="og:description" content="From OG">')).toMatchObject({
      title: null,
      description: 'From OG',
    });
    expect(extractMetadata('')).toEqual({
      title: null,
      description: null,
      siteName: null,
      ogTitle: null,
      ogDescription: null,
    });
  });

  it('keeps the first occurrence of a duplicated meta tag', () => {
    const page = '<meta name="description" content="first"><meta name="description" content="second">';
    expect(extractMetadata(page).description).toBe('first');
  });
});

describe('helpers', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&#169; 2026 &#x2014; it&#39;s &lt;ok&gt; &unknown;')).toBe("© 2026 — it's <ok> &unknown;");
  });

  it('cleans whitespace, caps length and nulls empty values', () => {
    expect(clean('  a \n\t b  ')).toBe('a b');
    expect(clean('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(clean('   ')).toBeNull();
    expect(clean(undefined)).toBeNull();
  });
});
