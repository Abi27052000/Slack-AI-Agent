import prisma from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { pipeline } from './pipeline.service.js';

export const ANALYSIS_STATUSES = ['PENDING', 'RESEARCHING', 'ANALYZING', 'ANALYZED', 'POSTED', 'FAILED'];
export const FIT_TIERS = ['HOT', 'WARM', 'COOL', 'COLD'];

const DAY_MS = 24 * 60 * 60 * 1000;

const MEMBER_SUMMARY = { id: true, name: true, email: true, title: true, avatarUrl: true, slackUserId: true };

/** Fields for list views: everything except the heavy JSON (research data, token usage). */
const ANALYSIS_SUMMARY = {
  id: true,
  status: true,
  trigger: true,
  fitScore: true,
  tier: true,
  confidence: true,
  summary: true,
  isFallback: true,
  error: true,
  model: true,
  promptVersion: true,
  attempts: true,
  durationMs: true,
  postedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
};

/** Translates validated list filters into a Prisma `where`. */
export function buildAnalysisWhere({ status, tier, minScore, maxScore, search, isFallback, memberId } = {}) {
  const where = {};
  if (status?.length) where.status = { in: status };
  if (tier?.length) where.tier = { in: tier };
  if (minScore !== undefined || maxScore !== undefined) {
    where.fitScore = {
      ...(minScore !== undefined && { gte: minScore }),
      ...(maxScore !== undefined && { lte: maxScore }),
    };
  }
  if (isFallback !== undefined) where.isFallback = isFallback;
  if (memberId) where.memberId = memberId;
  if (search) {
    const contains = { contains: search, mode: 'insensitive' };
    where.member = { OR: [{ name: contains }, { email: contains }, { title: contains }] };
  }
  return where;
}

export function buildAnalysisOrderBy({ sort = 'createdAt', order = 'desc' } = {}) {
  if (sort === 'fitScore') {
    // Unscored (fallback/in-progress) analyses go last either way; ties broken by recency.
    return [{ fitScore: { sort: order, nulls: 'last' } }, { createdAt: 'desc' }];
  }
  return [{ createdAt: order }];
}

/** GET /api/analyses */
export async function listAnalyses({ page = 1, pageSize = 20, sort, order, ...filters }) {
  const where = buildAnalysisWhere(filters);
  const [data, total] = await prisma.$transaction([
    prisma.memberAnalysis.findMany({
      where,
      orderBy: buildAnalysisOrderBy({ sort, order }),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { ...ANALYSIS_SUMMARY, member: { select: MEMBER_SUMMARY } },
    }),
    prisma.memberAnalysis.count({ where }),
  ]);

  return {
    data,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/** GET /api/analyses/:id: the full analysis plus the member's other analyses (newest first). */
export async function getAnalysisDetail(id) {
  const analysis = await prisma.memberAnalysis.findUnique({ where: { id }, include: { member: true } });
  if (!analysis) throw AppError.notFound(`Analysis ${id} not found`);

  const history = await prisma.memberAnalysis.findMany({
    where: { memberId: analysis.memberId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, status: true, trigger: true, fitScore: true, tier: true, isFallback: true, createdAt: true },
  });

  return { ...analysis, history };
}

/**
 * POST /api/analyses/:id/reanalyze: queues a fresh analysis of the same member, ignoring the
 * cooldown. Returns the pipeline decision ({ status: 'queued' | 'skipped', analysisId, reason? }).
 */
export async function reanalyze(id) {
  const analysis = await prisma.memberAnalysis.findUnique({ where: { id }, include: { member: true } });
  if (!analysis) throw AppError.notFound(`Analysis ${id} not found`);
  return pipeline.enqueue({ member: analysis.member, trigger: 'manual', force: true });
}

const zeroFilled = (keys, rows, key) =>
  Object.fromEntries(keys.map((k) => [k, rows.find((row) => row[key] === k)?._count._all ?? 0]));

/** Builds one entry per day in the range, filling days without analyses with zeros. */
export function fillDailySeries(rows, { days, now = new Date() }) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(day);
    series.push({ date: day, count: row?.count ?? 0, averageScore: row?.avg_score ?? null });
  }
  return series;
}

/** GET /api/stats: all-time totals plus a daily series and token usage for the last `days` days. */
export async function getStats({ days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);

  const [members, byStatus, byTier, scored, fallback, daily, tokens] = await Promise.all([
    prisma.member.count(),
    prisma.memberAnalysis.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.memberAnalysis.groupBy({ by: ['tier'], where: { tier: { not: null } }, _count: { _all: true } }),
    prisma.memberAnalysis.aggregate({
      where: { fitScore: { not: null }, isFallback: false },
      _avg: { fitScore: true },
      _count: { _all: true },
    }),
    prisma.memberAnalysis.count({ where: { isFallback: true } }),
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             count(*)::int AS count,
             round(avg(fit_score) FILTER (WHERE NOT is_fallback))::int AS avg_score
      FROM member_analyses
      WHERE created_at >= ${since}
      GROUP BY 1
      ORDER BY 1`,
    prisma.$queryRaw`
      SELECT coalesce(sum((usage->>'totalTokens')::int), 0)::int AS total
      FROM member_analyses
      WHERE created_at >= ${since} AND usage IS NOT NULL`,
  ]);

  const statusCounts = zeroFilled(ANALYSIS_STATUSES, byStatus, 'status');

  return {
    totals: {
      members,
      analyses: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
      scored: scored._count._all,
      fallback,
      byStatus: statusCounts,
    },
    averageScore: scored._avg.fitScore === null ? null : Math.round(scored._avg.fitScore),
    tiers: zeroFilled(FIT_TIERS, byTier, 'tier'),
    range: { days, since: since.toISOString() },
    daily: fillDailySeries(daily, { days, now }),
    tokens: { total: tokens[0]?.total ?? 0 },
    queue: pipeline.stats(),
  };
}
