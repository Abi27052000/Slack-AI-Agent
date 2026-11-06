import config from '../config/index.js';
import { getReadinessChecks } from '../lib/lifecycle.js';

/** Liveness: the process is up and serving requests. */
export const getHealth = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: config.appName,
    version: config.appVersion,
    env: config.env,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

/**
 * Readiness: dependencies are reachable and the service can do real work.
 * Checks are registered via lib/lifecycle.js (database, Slack, ... in later steps).
 */
export const getReadiness = async (req, res) => {
  const entries = await Promise.all(
    getReadinessChecks().map(async ([name, check]) => {
      try {
        return [name, (await check()) ? 'up' : 'down'];
      } catch {
        return [name, 'down'];
      }
    }),
  );

  const checks = Object.fromEntries(entries);
  const ready = Object.values(checks).every((state) => state === 'up');

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
};
