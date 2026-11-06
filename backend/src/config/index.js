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
  appName: pkg.name,
  appVersion: pkg.version,
});

export default config;
