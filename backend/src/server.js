import app from './app.js';
import config from './config/index.js';
import logger from './lib/logger.js';
import { getShutdownHooks } from './lib/lifecycle.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(config.port, () => {
  logger.info(`Server running on http://localhost:${config.port} (${config.env})`);
});

server.on('error', (err) => {
  logger.fatal({ err }, 'Failed to start HTTP server');
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    for (const { name, fn } of getShutdownHooks()) {
      await fn();
      logger.info(`Closed ${name}`);
    }
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
