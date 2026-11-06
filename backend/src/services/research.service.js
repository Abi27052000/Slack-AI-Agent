import config from '../config/index.js';
import logger from '../lib/logger.js';
import { getEmailDomain, isPersonalEmail } from '../utils/email.js';
import { withTimeout } from '../utils/withTimeout.js';
import { researchCompany } from '../integrations/research/company.js';
import { researchGitHub } from '../integrations/research/github.js';

const log = logger.child({ module: 'research' });

/**
 * A provider looks up one public source about a member.
 *   name:      identifier stored with results/errors
 *   skipReason(ctx): string explaining why it doesn't apply, or null to run
 *   run(ctx, { signal }): resolves to a source object, or null when nothing was found
 * Add a provider by appending to this list (e.g. LinkedIn via an API, Clearbit, ...).
 */
export const defaultProviders = [
  {
    name: 'company_website',
    skipReason: (ctx) => {
      if (!ctx.domain) return 'no email';
      if (ctx.isPersonalEmail) return 'personal email domain';
      return null;
    },
    run: (ctx, { signal }) => researchCompany(ctx.domain, { signal }),
  },
  {
    name: 'github',
    skipReason: (ctx) => (ctx.email || ctx.name ? null : 'no email or name'),
    run: (ctx, { signal }) =>
      researchGitHub({ email: ctx.email, name: ctx.name }, { signal, token: config.research.githubToken }),
  },
];

/** Normalises the member fields the providers care about. */
export function buildResearchContext(member) {
  const email = member.email?.trim() || null;
  return {
    name: member.name?.trim() || null,
    email,
    domain: getEmailDomain(email),
    isPersonalEmail: isPersonalEmail(email),
  };
}

/**
 * Runs all applicable providers in parallel, each with its own time budget.
 * Never throws: provider failures and timeouts are reported in `errors` so the analysis can
 * still proceed on whatever was found.
 *
 * @returns {Promise<{ sources: object[], skipped: {provider, reason}[], errors: {provider, code, message}[], durationMs: number }>}
 */
export async function researchMember(
  member,
  { providers = defaultProviders, timeoutMs = config.research.timeoutMs } = {},
) {
  const started = Date.now();
  const ctx = buildResearchContext(member);
  const skipped = [];
  const active = [];

  for (const provider of providers) {
    const reason = provider.skipReason(ctx);
    if (reason) skipped.push({ provider: provider.name, reason });
    else active.push(provider);
  }

  const settled = await Promise.allSettled(
    active.map((provider) =>
      withTimeout((signal) => provider.run(ctx, { signal }), timeoutMs, `${provider.name} research`),
    ),
  );

  const sources = [];
  const errors = [];

  settled.forEach((outcome, i) => {
    const { name } = active[i];
    if (outcome.status === 'fulfilled') {
      if (outcome.value) sources.push(outcome.value);
    } else {
      const err = outcome.reason;
      errors.push({ provider: name, code: err?.code ?? 'ERROR', message: err?.message ?? String(err) });
    }
  });

  const result = { sources, skipped, errors, durationMs: Date.now() - started };

  log.info(
    { member: ctx.name, sources: sources.map((s) => s.provider), skipped: skipped.length, errors: errors.length, durationMs: result.durationMs },
    `Research finished: ${sources.length} source(s)`,
  );
  for (const error of errors) log.warn(`${error.provider} research failed: ${error.message}`);

  return result;
}
