import app from './app.js';
import config from './config/index.js';
import logger from './lib/logger.js';
import { getShutdownHooks, onShutdown, registerReadinessCheck } from './lib/lifecycle.js';
import { checkDatabase, connectDatabase, disconnectDatabase } from './lib/prisma.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let server;
let shuttingDown = false;

async function start() {
  // Dependencies first, so we never accept traffic we can't serve.
  await connectDatabase();
  registerReadinessCheck('database', checkDatabase);
  onShutdown('database', disconnectDatabase);

  server = app.listen(config.port, () => {
    logger.info(`Server running on http://localhost:${config.port} (${config.env})`);
  });

  server.on('error', (err) => {
    logger.fatal({ err }, 'Failed to start HTTP server');
    process.exit(1);
  });
}

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
    if (server) {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
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

start().catch((err) => {
  logger.fatal(`Startup failed: ${err.message}`);
  process.exit(1);
});
