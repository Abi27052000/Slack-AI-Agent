import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { AppError } from '../../src/lib/errors.js';

vi.mock('../../src/services/dashboard.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listAnalyses: vi.fn(async ({ page, pageSize }) => ({ data: [{ id: 'a1' }], pagination: { page, pageSize, total: 1, totalPages: 1 } })),
    getAnalysisDetail: vi.fn(async (id) => {
      if (id !== 'a1') throw AppError.notFound(`Analysis ${id} not found`);
      return { id: 'a1', fitScore: 82, history: [] };
    }),
    reanalyze: vi.fn(async () => ({ status: 'queued', analysisId: 'a2' })),
    getStats: vi.fn(async ({ days }) => ({ range: { days }, totals: { analyses: 3 } })),
  };
});

const { default: app } = await import('../../src/app.js');
const dashboard = await import('../../src/services/dashboard.service.js');

// Matches ADMIN_API_KEY in vitest.config.js
const auth = { Authorization: 'Bearer test-admin-key-0123456789abcdef' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authentication', () => {
  it.each(['/api/analyses', '/api/analyses/a1', '/api/stats'])('GET %s requires the API key', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it('POST /api/analyses/:id/reanalyze requires the API key', async () => {
    expect((await request(app).post('/api/analyses/a1/reanalyze')).status).toBe(401);
    expect(dashboard.reanalyze).not.toHaveBeenCalled();
  });

  it('keeps health checks public', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

describe('GET /api/analyses', () => {
  it('applies defaults', async () => {
    const res = await request(app).get('/api/analyses').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(dashboard.listAnalyses).toHaveBeenCalledWith({ page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' });
  });

  it('parses and coerces filters', async () => {
    await request(app)
      .get('/api/analyses')
      .query({
        page: '2',
        pageSize: '50',
        status: 'posted,analyzed',
        tier: 'HOT',
        minScore: '60',
        maxScore: '100',
        search: '  jane ',
        isFallback: 'false',
        sort: 'fitScore',
        order: 'asc',
      })
      .set(auth)
      .expect(200);

    expect(dashboard.listAnalyses).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
      status: ['POSTED', 'ANALYZED'],
      tier: ['HOT'],
      minScore: 60,
      maxScore: 100,
      search: 'jane',
      isFallback: false,
      sort: 'fitScore',
      order: 'asc',
    });
  });

  it('accepts repeated query params', async () => {
    await request(app).get('/api/analyses?status=POSTED&status=FAILED').set(auth).expect(200);
    expect(dashboard.listAnalyses.mock.calls[0][0].status).toEqual(['POSTED', 'FAILED']);
  });

  it.each([
    ['unknown status', { status: 'DONE' }, 'status'],
    ['unknown tier', { tier: 'LUKEWARM' }, 'tier'],
    ['page size too large', { pageSize: '500' }, 'pageSize'],
    ['score out of range', { minScore: '101' }, 'minScore'],
    ['min above max', { minScore: '80', maxScore: '20' }, 'minScore'],
    ['bad sort', { sort: 'name' }, 'sort'],
    ['bad boolean', { isFallback: 'yes' }, 'isFallback'],
  ])('rejects %s', async (_label, query, path) => {
    const res = await request(app).get('/api/analyses').query(query).set(auth);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      // array filters report the offending element, e.g. "status.0"
      expect.arrayContaining([expect.objectContaining({ location: 'query', path: expect.stringMatching(new RegExp(`^${path}`)) })]),
    );
    expect(dashboard.listAnalyses).not.toHaveBeenCalled();
  });
});

describe('GET /api/analyses/:id', () => {
  it('returns the analysis', async () => {
    const res = await request(app).get('/api/analyses/a1').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'a1', fitScore: 82, history: [] });
  });

  it('404s for unknown ids', async () => {
    const res = await request(app).get('/api/analyses/missing').set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/analyses/:id/reanalyze', () => {
  it('returns 202 when a new analysis is queued', async () => {
    const res = await request(app).post('/api/analyses/a1/reanalyze').set(auth);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'queued', analysisId: 'a2' });
    expect(dashboard.reanalyze).toHaveBeenCalledWith('a1');
  });

  it('returns 409 when an analysis is already running for the member', async () => {
    dashboard.reanalyze.mockResolvedValueOnce({ status: 'skipped', reason: 'analysis_in_progress', analysisId: 'a3' });
    const res = await request(app).post('/api/analyses/a1/reanalyze').set(auth);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('analysis_in_progress');
  });
});

describe('GET /api/stats', () => {
  it('defaults to 7 days', async () => {
    const res = await request(app).get('/api/stats').set(auth);
    expect(res.status).toBe(200);
    expect(dashboard.getStats).toHaveBeenCalledWith({ days: 7 });
  });

  it('validates the range', async () => {
    await request(app).get('/api/stats?days=30').set(auth).expect(200);
    expect(dashboard.getStats).toHaveBeenCalledWith({ days: 30 });
    expect((await request(app).get('/api/stats?days=365').set(auth)).status).toBe(400);
  });
});
