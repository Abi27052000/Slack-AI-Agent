import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/index.js';
import requestLogger from './middlewares/requestLogger.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middlewares/errorHandler.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
