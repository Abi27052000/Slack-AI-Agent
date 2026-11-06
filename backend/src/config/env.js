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
}).superRefine((env, ctx) => {
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
