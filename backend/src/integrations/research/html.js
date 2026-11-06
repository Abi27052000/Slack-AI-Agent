/** Tiny, dependency-free extraction of page metadata (title, description, Open Graph). */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return NAMED_ENTITIES[key] ?? match;
  });
}

/** Decode, collapse whitespace and cap length; returns null for empty values. */
export function clean(text, maxLength = 300) {
  if (!text) return null;
  const value = decodeEntities(text).replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function parseAttributes(tag) {
  const attrs = {};
  for (const [, name, , dq, sq, bare] of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[name.toLowerCase()] = dq ?? sq ?? bare;
  }
  return attrs;
}

/**
 * @returns {{ title: string|null, description: string|null, siteName: string|null,
 *             ogTitle: string|null, ogDescription: string|null }}
 */
export function extractMetadata(html) {
  const head = html.slice(0, 200_000);
  const meta = {};

  for (const [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);

  return {
    title: clean(titleMatch?.[1], 200),
    description: clean(meta.description ?? meta['og:description'] ?? meta['twitter:description']),
    siteName: clean(meta['og:site_name'], 100),
    ogTitle: clean(meta['og:title'], 200),
    ogDescription: clean(meta['og:description']),
  };
}
