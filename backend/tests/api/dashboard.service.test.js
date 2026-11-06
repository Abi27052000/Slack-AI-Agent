import { describe, it, expect } from 'vitest';
import {
  buildAnalysisOrderBy,
  buildAnalysisWhere,
  fillDailySeries,
} from '../../src/services/dashboard.service.js';

describe('buildAnalysisWhere', () => {
  it('returns an empty filter by default', () => {
    expect(buildAnalysisWhere()).toEqual({});
    expect(buildAnalysisWhere({ status: [], tier: [] })).toEqual({});
  });

  it('combines all filters', () => {
    expect(
      buildAnalysisWhere({
        status: ['POSTED', 'ANALYZED'],
        tier: ['HOT'],
        minScore: 60,
        maxScore: 90,
        isFallback: false,
        memberId: 'm1',
        search: 'jane',
      }),
    ).toEqual({
      status: { in: ['POSTED', 'ANALYZED'] },
      tier: { in: ['HOT'] },
      fitScore: { gte: 60, lte: 90 },
      isFallback: false,
      memberId: 'm1',
      member: {
        OR: [
          { name: { contains: 'jane', mode: 'insensitive' } },
          { email: { contains: 'jane', mode: 'insensitive' } },
          { title: { contains: 'jane', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('supports open-ended score ranges, including 0', () => {
    expect(buildAnalysisWhere({ minScore: 0 })).toEqual({ fitScore: { gte: 0 } });
    expect(buildAnalysisWhere({ maxScore: 39 })).toEqual({ fitScore: { lte: 39 } });
  });

  it('filters fallbacks in both directions', () => {
    expect(buildAnalysisWhere({ isFallback: true })).toEqual({ isFallback: true });
  });
});

describe('buildAnalysisOrderBy', () => {
  it('defaults to newest first', () => {
    expect(buildAnalysisOrderBy()).toEqual([{ createdAt: 'desc' }]);
    expect(buildAnalysisOrderBy({ sort: 'createdAt', order: 'asc' })).toEqual([{ createdAt: 'asc' }]);
  });

  it('sorts by score with unscored analyses last', () => {
    expect(buildAnalysisOrderBy({ sort: 'fitScore', order: 'asc' })).toEqual([
      { fitScore: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ]);
  });
});

describe('fillDailySeries', () => {
  const now = new Date('2026-11-06T15:00:00Z');

  it('returns one entry per day, oldest first, with gaps filled', () => {
    const series = fillDailySeries(
      [
        { day: '2026-11-04', count: 3, avg_score: 71 },
        { day: '2026-11-06', count: 1, avg_score: null },
      ],
      { days: 4, now },
    );

    expect(series).toEqual([
      { date: '2026-11-03', count: 0, averageScore: null },
      { date: '2026-11-04', count: 3, averageScore: 71 },
      { date: '2026-11-05', count: 0, averageScore: null },
      { date: '2026-11-06', count: 1, averageScore: null },
    ]);
  });

  it('handles a single day', () => {
    expect(fillDailySeries([], { days: 1, now })).toEqual([{ date: '2026-11-06', count: 0, averageScore: null }]);
  });
});
