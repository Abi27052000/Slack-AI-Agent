import { z } from 'zod';
import {
  ANALYSIS_STATUSES,
  FIT_TIERS,
  getAnalysisDetail,
  listAnalyses,
  reanalyze,
} from '../services/dashboard.service.js';

/** "POSTED,ANALYZED" or ?status=POSTED&status=ANALYZED -> ['POSTED', 'ANALYZED'] (upper-cased). */
const csvEnum = (values) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((raw) =>
      (Array.isArray(raw) ? raw : raw.split(','))
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)));

const score = z.coerce.number().int().min(0).max(100);

export const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: csvEnum(ANALYSIS_STATUSES).optional(),
    tier: csvEnum(FIT_TIERS).optional(),
    minScore: score.optional(),
    maxScore: score.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    isFallback: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    memberId: z.string().min(1).max(50).optional(),
    sort: z.enum(['createdAt', 'fitScore']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => q.minScore === undefined || q.maxScore === undefined || q.minScore <= q.maxScore, {
    message: 'minScore must be less than or equal to maxScore',
    path: ['minScore'],
  });

export const idParamsSchema = z.object({ id: z.string().min(1).max(50) });

/** GET /api/analyses */
export const list = async (req, res) => {
  res.json(await listAnalyses(req.validated.query));
};

/** GET /api/analyses/:id */
export const detail = async (req, res) => {
  res.json(await getAnalysisDetail(req.validated.params.id));
};

/**
 * POST /api/analyses/:id/reanalyze
 * 202 when a new analysis was queued; 409 when one is already running for this member.
 */
export const rerun = async (req, res) => {
  const decision = await reanalyze(req.validated.params.id);
  res.status(decision.status === 'queued' ? 202 : 409).json(decision);
};
