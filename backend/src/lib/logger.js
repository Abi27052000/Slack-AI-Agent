import pino from 'pino';
import config from '../config/index.js';

const logger = pino({
  level: config.logLevel,
  base: { app: config.appName, env: config.env },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  ...(config.isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,app,env' },
    },
  }),
});

export default logger;
