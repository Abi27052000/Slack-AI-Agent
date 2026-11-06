import { z } from 'zod';
import { getStats } from '../services/dashboard.service.js';

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

/** GET /api/stats */
export const stats = async (req, res) => {
  res.json(await getStats({ days: req.validated.query.days }));
};
