import { safeFetchText } from '../../utils/safeFetch.js';
import { extractMetadata } from './html.js';

/**
 * Looks up the company behind a work-email domain by reading its homepage metadata.
 * Tries https://domain, then https://www.domain. Resolves to null when nothing useful is found.
 *
 * @returns {Promise<null | {
 *   provider: 'company_website', type: 'company', url: string, title: string,
 *   summary: string|null, confidence: 'high', data: object }>}
 */
export async function researchCompany(domain, { signal, fetchOptions = {} } = {}) {
  const candidates = [`https://${domain}`, `https://www.${domain}`];
  let lastError;

  for (const url of candidates) {
    try {
      const page = await safeFetchText(url, { signal, ...fetchOptions });
      if (page.status >= 400 || !/html/i.test(page.contentType)) continue;

      const meta = extractMetadata(page.text);
      if (!meta.title && !meta.description && !meta.siteName) continue;

      return {
        provider: 'company_website',
        type: 'company',
        url: page.url,
        title: meta.siteName ?? meta.ogTitle ?? meta.title ?? domain,
        summary: meta.description,
        // The domain comes straight from the member's work email, so the match is certain.
        confidence: 'high',
        data: { domain, pageTitle: meta.title, siteName: meta.siteName, description: meta.description },
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }

  // Both candidates failed outright (DNS, SSRF guard, network): surface the error to the service.
  if (lastError) throw lastError;
  return null;
}
