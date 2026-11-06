import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { parseEnv } from './env.js';

dotenv.config({ quiet: true });

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

let env;
try {
  env = parseEnv();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const defaultLogLevel = { development: 'debug', test: 'silent', production: 'info' };

const config = Object.freeze({
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL ?? defaultLogLevel[env.NODE_ENV],
  corsOrigins: env.CORS_ORIGIN,
  database: Object.freeze({
    url: env.DATABASE_URL,
    poolMax: env.DATABASE_POOL_MAX,
  }),
  slack: Object.freeze({
    enabled: Boolean(env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN),
    botToken: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    watchChannelIds: Object.freeze(env.SLACK_WATCH_CHANNEL_IDS),
    reportChannelId: env.SLACK_REPORT_CHANNEL_ID,
  }),
  appName: pkg.name,
  appVersion: pkg.version,
});

export default config;
