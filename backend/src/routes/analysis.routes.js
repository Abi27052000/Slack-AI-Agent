import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { detail, idParamsSchema, list, listQuerySchema, rerun } from '../controllers/analysis.controller.js';

const router = Router();

router.get('/', validate({ query: listQuerySchema }), list);
router.get('/:id', validate({ params: idParamsSchema }), detail);
router.post('/:id/reanalyze', validate({ params: idParamsSchema }), rerun);

export default router;
