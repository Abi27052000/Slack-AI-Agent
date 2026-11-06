import { Router } from 'express';
import {
  getAnalysisPreview,
  runAnalysis,
  runResearch,
  simulateSlackEvent,
} from '../controllers/dev.controller.js';

/** Development-only helpers. Never mounted in production (see routes/index.js). */
const router = Router();

router.post('/slack/events', simulateSlackEvent);
router.post('/research', runResearch);
router.post('/analyze', runAnalysis);
router.get('/analyses/:id', getAnalysisPreview);

export default router;
