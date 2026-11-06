import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import logger from '../lib/logger.js';

const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  // Health probes run constantly; don't flood the logs with them.
  autoLogging: { ignore: (req) => req.url.startsWith('/api/health') },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

export default requestLogger;
