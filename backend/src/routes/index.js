import { Router } from 'express';
import config from '../config/index.js';
import healthRoutes from './health.routes.js';
import devRoutes from './dev.routes.js';

const router = Router();

router.use('/health', healthRoutes);

if (!config.isProd) {
  router.use('/dev', devRoutes);
}

export default router;
