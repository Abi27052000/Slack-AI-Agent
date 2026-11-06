import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import config from '../config/index.js';
import logger from './logger.js';

const log = logger.child({ module: 'prisma' });

/**
 * Single PrismaClient for the whole process (each instance owns a connection pool).
 * Prisma 7 talks to Postgres through the `pg` driver adapter.
 */
const adapter = new PrismaPg({
  connectionString: config.database.url,
  max: config.database.poolMax,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('warn', (event) => log.warn(event.message));
prisma.$on('error', (event) => log.error(event.message));

/**
 * Prisma connection errors often carry an empty "Invalid `prisma.$queryRaw()` invocation" message
 * with the real cause only in `code` (e.g. ECONNREFUSED, 28P01). Build a readable one-liner.
 */
export function describeDbError(err) {
  const message = err?.message?.replace(/Invalid `prisma\.\S+` invocation:/, '').trim();
  return [err?.code, message].filter(Boolean).join(': ') || 'Unknown database error';
}

/** Readiness probe: true when a trivial query succeeds. */
export async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    log.warn(`Database health check failed: ${describeDbError(err)}`);
    return false;
  }
}

/** Connect on startup, retrying a few times (e.g. while a Docker container boots). */
export async function connectDatabase({ retries = 5, delayMs = 2_000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      log.info('Database connected');
      return;
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Could not connect to the database: ${describeDbError(err)}`, { cause: err });
      }
      log.warn(`Database not reachable (attempt ${attempt}/${retries}): ${describeDbError(err)}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export default prisma;
