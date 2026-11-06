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

  it('requires a postgres DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL is required/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql:\/\//);
  });
});
