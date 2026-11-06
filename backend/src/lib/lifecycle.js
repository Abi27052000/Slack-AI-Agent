/**
 * Central registry for process lifecycle concerns, so integrations (Prisma, Slack, ...)
 * can plug in without importing server.js.
 */

const shutdownHooks = [];
const readinessChecks = new Map();

/** Register cleanup to run on graceful shutdown (runs in registration order). */
export function onShutdown(name, fn) {
  shutdownHooks.push({ name, fn });
}

export function getShutdownHooks() {
  return [...shutdownHooks];
}

/** Register a readiness check: an async fn resolving to true when the dependency is healthy. */
export function registerReadinessCheck(name, check) {
  readinessChecks.set(name, check);
}

export function removeReadinessCheck(name) {
  readinessChecks.delete(name);
}

export function getReadinessChecks() {
  return [...readinessChecks.entries()];
}
