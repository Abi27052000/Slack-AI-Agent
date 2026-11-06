import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 5000,
      CORS_ORIGIN: ['http://localhost:5173'],
      DATABASE_URL,
      DATABASE_POOL_MAX: 10,
      SLACK_WATCH_CHANNEL_IDS: [],
    });
  });

  it('coerces and parses values', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      CORS_ORIGIN: 'https://a.com, https://b.com',
      DATABASE_URL,
      DATABASE_POOL_MAX: '25',
      SLACK_BOT_TOKEN: 'xoxb-1',
      SLACK_APP_TOKEN: 'xapp-1',
    });

    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_LEVEL: 'warn',
      CORS_ORIGIN: ['https://a.com', 'https://b.com'],
      DATABASE_POOL_MAX: 25,
    });
  });

  it('treats empty values as unset', () => {
    expect(parseEnv({ DATABASE_URL, LOG_LEVEL: '', PORT: '' })).toMatchObject({ PORT: 5000 });
  });

  it('throws a readable error listing invalid variables', () => {
    let message = '';
    try {
      parseEnv({ PORT: 'abc', NODE_ENV: 'staging', DATABASE_URL });
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/^Invalid environment configuration:/);
    expect(message).toContain('PORT');
    expect(message).toContain('NODE_ENV');
  });

  describe('Slack', () => {
    const tokens = { SLACK_BOT_TOKEN: 'xoxb-1', SLACK_APP_TOKEN: 'xapp-1' };

    it('is optional outside production', () => {
      expect(() => parseEnv({ DATABASE_URL })).not.toThrow();
    });

    it('parses tokens and watched channels', () => {
      expect(
        parseEnv({ DATABASE_URL, ...tokens, SLACK_WATCH_CHANNEL_IDS: 'C1, C2' }),
      ).toMatchObject({ ...tokens, SLACK_WATCH_CHANNEL_IDS: ['C1', 'C2'] });
    });

    it('requires both tokens together', () => {
      expect(() => parseEnv({ DATABASE_URL, SLACK_BOT_TOKEN: 'xoxb-1' })).toThrow(
        /SLACK_APP_TOKEN: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set together/,
      );
    });

    it('validates token prefixes', () => {
      expect(() =>
        parseEnv({ DATABASE_URL, SLACK_BOT_TOKEN: 'xapp-wrong', SLACK_APP_TOKEN: 'xapp-1' }),
      ).toThrow(/SLACK_BOT_TOKEN: must be a bot token/);
    });

    it('is required in production', () => {
      expect(() => parseEnv({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(
        /Slack tokens are required in production/,
      );
      expect(() => parseEnv({ DATABASE_URL, NODE_ENV: 'production', ...tokens })).not.toThrow();
    });
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL is required/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql:\/\//);
  });
});
