import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequireAdmin, safeEqual } from '../../src/middlewares/auth.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';

const KEY = 'a-very-secret-admin-key-123456';

function appWith(apiKey) {
  const app = express();
  app.get('/secret', createRequireAdmin({ apiKey }), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('requireAdmin', () => {
  const app = appWith(KEY);

  it('accepts a Bearer token', async () => {
    const res = await request(app).get('/secret').set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
  });

  it('accepts an X-API-Key header', async () => {
    const res = await request(app).get('/secret').set('X-API-Key', KEY);
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing', {}],
    ['wrong', { Authorization: 'Bearer nope' }],
    ['prefix of the key', { Authorization: `Bearer ${KEY.slice(0, 10)}` }],
    ['not a bearer scheme', { Authorization: `Basic ${KEY}` }],
  ])('rejects a %s key with 401', async (_label, headers) => {
    const res = await request(app).get('/secret').set(headers);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="admin"');
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('lets requests through when no key is configured (development)', async () => {
    const res = await request(appWith(undefined)).get('/secret');
    expect(res.status).toBe(200);
  });
});

describe('safeEqual', () => {
  it('compares strings of different lengths without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
