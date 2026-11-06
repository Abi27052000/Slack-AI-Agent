import { Router } from 'express';
import { simulateSlackEvent } from '../controllers/dev.controller.js';

/** Development-only helpers. Never mounted in production (see routes/index.js). */
const router = Router();

router.post('/slack/events', simulateSlackEvent);

export default router;
