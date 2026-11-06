import { Router } from 'express';
import { runAnalysis, runResearch, simulateSlackEvent } from '../controllers/dev.controller.js';

/** Development-only helpers. Never mounted in production (see routes/index.js). */
const router = Router();

router.post('/slack/events', simulateSlackEvent);
router.post('/research', runResearch);
router.post('/analyze', runAnalysis);

export default router;
