import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { stats, statsQuerySchema } from '../controllers/stats.controller.js';

const router = Router();

router.get('/', validate({ query: statsQuerySchema }), stats);

export default router;
