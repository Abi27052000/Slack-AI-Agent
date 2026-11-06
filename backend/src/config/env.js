import { z } from 'zod';

const commaSeparatedList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),
  CORS_ORIGIN: commaSeparatedList.default(['http://localhost:5173']),

  // Database
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required (see .env.example)' })
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Slack (Socket Mode). Optional in development/test: without tokens the Slack integration is
  // disabled and events can be simulated via POST /api/dev/slack/events.
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-', 'must be a bot token (xoxb-...)').optional(),
  SLACK_APP_TOKEN: z.string().startsWith('xapp-', 'must be an app-level token (xapp-...)').optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  // Channels whose `member_joined_channel` events trigger the agent. Empty = only `team_join`.
  SLACK_WATCH_CHANNEL_IDS: commaSeparatedList.default([]),
  // Private channel the analysis reports are posted to (used from step 6).
  SLACK_REPORT_CHANNEL_ID: z.string().optional(),

  // Research
  // Optional: raises the GitHub API limit from 60 to 5,000 requests/hour (no scopes needed).
  GITHUB_TOKEN: z.string().optional(),
  // Per-provider time budget; a slow provider is dropped, never blocks the analysis.
  RESEARCH_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8_000),

  // Gemini (member-fit analysis). Optional outside production: without a key every analysis is
  // stored as a fallback that needs manual review.
  GEMINI_API_KEY: z.string().optional(),
  // Stable model IDs: https://ai.google.dev/gemini-api/docs/models
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(6).default(3),

  // Company context used in the analysis prompt
  COMPANY_NAME: z.string().default('Your Company'),
  COMPANY_PRODUCT: z.string().default('Your Product'),
  COMPANY_DESCRIPTION: z.string().optional(),
  // Who is a great fit, e.g. "Engineering leaders at 50-500 person B2B SaaS companies"
  IDEAL_CUSTOMER_PROFILE: z.string().optional(),

  // Pipeline
  // A member analysed within this many days is not re-analysed on their next join event.
  REANALYZE_COOLDOWN_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  // How many members are researched/analysed at the same time (protects API rate limits).
  PIPELINE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  // Admin dashboard base URL; when set, Slack reports link to the analysis there.
  DASHBOARD_URL: z.url().optional(),

  // Admin API (dashboard). Bearer token for /api/analyses, /api/stats, ...
  // Optional in development (the API is then open, with a warning). Generate: openssl rand -hex 32
  ADMIN_API_KEY: z.string().min(24, 'must be at least 24 characters (generate one with: openssl rand -hex 32)').optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.ADMIN_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: 'ADMIN_API_KEY is required in production',
    });
  }

  if (env.NODE_ENV === 'production' && !env.GEMINI_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['GEMINI_API_KEY'],
      message: 'GEMINI_API_KEY is required in production',
    });
  }

  const hasBot = Boolean(env.SLACK_BOT_TOKEN);
  const hasApp = Boolean(env.SLACK_APP_TOKEN);

  if (hasBot !== hasApp) {
    ctx.addIssue({
      code: 'custom',
      path: [hasBot ? 'SLACK_APP_TOKEN' : 'SLACK_BOT_TOKEN'],
      message: 'SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set together',
    });
  }

  if (env.NODE_ENV === 'production' && !(hasBot && hasApp)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SLACK_BOT_TOKEN'],
      message: 'Slack tokens are required in production',
    });
  }
});

/**
 * Validates environment variables and returns a typed config object.
 * Throws a readable error listing every invalid variable.
 */
export function parseEnv(source = process.env) {
  // Treat empty values (e.g. `LOG_LEVEL=` in .env) as unset so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
