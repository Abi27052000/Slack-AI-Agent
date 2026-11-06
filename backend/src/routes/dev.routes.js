import { Router } from 'express';
import { runResearch, simulateSlackEvent } from '../controllers/dev.controller.js';

/** Development-only helpers. Never mounted in production (see routes/index.js). */
const router = Router();

router.post('/slack/events', simulateSlackEvent);
router.post('/research', runResearch);

export default router;
