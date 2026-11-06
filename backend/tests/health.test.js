import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { registerReadinessCheck, removeReadinessCheck } from '../src/lib/lifecycle.js';

describe('GET /api/health', () => {
  it('returns liveness info', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'backend', env: 'test' });
    expect(res.body.version).toEqual(expect.any(String));
    expect(res.body.uptime).toEqual(expect.any(Number));
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('echoes an incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('GET /api/health/ready', () => {
  afterEach(() => {
    removeReadinessCheck('test-down');
    removeReadinessCheck('test-throws');
  });

  it('is ready when there are no failing checks', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('returns 503 when a check fails or throws', async () => {
    registerReadinessCheck('test-down', async () => false);
    registerReadinessCheck('test-throws', async () => {
      throw new Error('boom');
    });

    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks).toMatchObject({ 'test-down': 'down', 'test-throws': 'down' });
  });
});
