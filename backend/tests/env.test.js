import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 5000,
      CORS_ORIGIN: ['http://localhost:5173'],
    });
  });

  it('coerces and parses values', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      CORS_ORIGIN: 'https://a.com, https://b.com',
    });

    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_LEVEL: 'warn',
      CORS_ORIGIN: ['https://a.com', 'https://b.com'],
    });
  });

  it('throws a readable error listing invalid variables', () => {
    expect(() => parseEnv({ PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      /Invalid environment configuration:[\s\S]*PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*PORT/,
    );
  });
});
