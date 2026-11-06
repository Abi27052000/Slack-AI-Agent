import { Router } from 'express';
import config from '../config/index.js';
import { requireAdmin } from '../middlewares/auth.js';
import healthRoutes from './health.routes.js';
import analysisRoutes from './analysis.routes.js';
import statsRoutes from './stats.routes.js';
import devRoutes from './dev.routes.js';

const router = Router();

// Public: used by hosting platforms / uptime monitors.
router.use('/health', healthRoutes);

// Admin dashboard API (API key required).
router.use('/analyses', requireAdmin, analysisRoutes);
router.use('/stats', requireAdmin, statsRoutes);

if (!config.isProd) {
  router.use('/dev', devRoutes);
}

export default router;
