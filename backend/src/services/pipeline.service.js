import PQueue from 'p-queue';
import config from '../config/index.js';
import logger from '../lib/logger.js';
import * as analysisRepository from './analysis.repository.js';
import { IN_FLIGHT_STATUSES } from './analysis.repository.js';
import { researchMember } from './research.service.js';
import { analyzeMember } from './analysis.service.js';
import { canPostReports, postMemberReport } from '../integrations/slack/report.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** An in-flight analysis older than this is assumed dead (crashed process) and stops blocking. */
const IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

const joinErrors = (...errors) => errors.filter(Boolean).join(' | ') || null;

/**
 * The analysis pipeline: duplicate check → PENDING → RESEARCHING → ANALYZING → ANALYZED → POSTED.
 * Every transition is persisted, so a failure leaves a FAILED record with the error instead of
 * vanishing, and work interrupted by a restart is picked up again (see recoverInterrupted).
 *
 * Dependencies are injected for testing; `pipeline` below is the wired-up instance.
 */
export function createPipeline({
  repo,
  research,
  analyze,
  report,
  canReport,
  concurrency,
  cooldownDays,
  logger: log,
  now = () => new Date(),
}) {
  // Limits concurrent research + LLM calls, so a burst of joins can't blow through rate limits.
  const queue = new PQueue({ concurrency });

  // The duplicate check and the PENDING insert run one at a time, so two events for the same
  // member arriving together can't both pass the check. (Cheap: two small queries.)
  let gate = Promise.resolve();
  const serialised = (fn) => {
    const run = gate.then(fn);
    gate = run.catch(() => {});
    return run;
  };

  async function runAnalysis(analysisId) {
    const record = await repo.getAnalysisWithMember(analysisId);
    if (!record) {
      log.warn(`Analysis ${analysisId} disappeared before it could run`);
      return;
    }

    const { member } = record;
    const started = Date.now();
    const tag = { analysisId, member: member.name };

    try {
      await repo.updateAnalysis(analysisId, { status: 'RESEARCHING' });
      const researchData = await research(member);

      await repo.updateAnalysis(analysisId, { status: 'ANALYZING', researchData });
      const result = await analyze(member, researchData);

      const analysis = await repo.updateAnalysis(analysisId, {
        status: 'ANALYZED',
        fitScore: result.fitScore,
        tier: result.tier,
        confidence: result.confidence,
        summary: result.summary,
        insights: result.insights,
        recommendations: result.recommendations,
        isFallback: result.isFallback,
        model: result.model,
        promptVersion: result.promptVersion,
        attempts: result.attempts,
        usage: result.usage ?? undefined,
        error: result.error ? `${result.error.code}: ${result.error.message}` : null,
        durationMs: Date.now() - started,
        completedAt: now(),
      });

      if (!canReport()) {
        log.info(tag, 'Analysis stored (Slack reporting not configured, not posted)');
        return;
      }

      try {
        const posted = await report({ member, analysis: { ...analysis, researchData } });
        await repo.updateAnalysis(analysisId, {
          status: 'POSTED',
          slackChannelId: posted.channel,
          slackMessageTs: posted.ts,
          postedAt: now(),
        });
        log.info(tag, 'Analysis report posted to Slack');
      } catch (err) {
        // The analysis itself succeeded: keep it (status ANALYZED) and record why it wasn't posted.
        const code = err.data?.error ?? err.code ?? 'ERROR';
        log.error({ ...tag, code }, `Failed to post report: ${err.message}`);
        await repo.updateAnalysis(analysisId, {
          error: joinErrors(analysis.error, `SLACK_POST_FAILED: ${code}`),
        });
      }
    } catch (err) {
      log.error({ ...tag, err }, 'Analysis pipeline failed');
      await repo
        .updateAnalysis(analysisId, {
          status: 'FAILED',
          error: `PIPELINE_ERROR: ${err.message}`,
          durationMs: Date.now() - started,
          completedAt: now(),
        })
        .catch((updateErr) => log.error({ ...tag, err: updateErr }, 'Could not mark analysis as FAILED'));
    }
  }

  function schedule(analysisId) {
    queue.add(() => runAnalysis(analysisId)).catch((err) => log.error({ analysisId, err }, 'Queue task crashed'));
  }

  /**
   * Hands a member to the pipeline. Resolves quickly (once the PENDING record exists) so Slack
   * events are acknowledged within Slack's 3-second limit; the actual work runs in the queue.
   *
   * `force` (manual re-analysis) ignores the cooldown, but never starts a second analysis while
   * one is already running for the member.
   *
   * @returns {Promise<{status: 'queued', analysisId} | {status: 'skipped', reason, analysisId}>}
   */
  async function enqueue({ member, trigger, channelId = null, force = false }) {
    const decision = await serialised(async () => {
      const current = now().getTime();
      const blocking = await repo.findBlockingAnalysis(member.id, {
        cooldownSince: force ? null : new Date(current - cooldownDays * DAY_MS),
        inFlightSince: new Date(current - IN_FLIGHT_STALE_MS),
      });
      if (blocking) {
        return {
          status: 'skipped',
          reason: IN_FLIGHT_STATUSES.includes(blocking.status) ? 'analysis_in_progress' : 'recently_analyzed',
          analysisId: blocking.id,
        };
      }
      const created = await repo.createPendingAnalysis({ memberId: member.id, trigger, triggerChannelId: channelId });
      return { status: 'queued', analysisId: created.id };
    });

    if (decision.status === 'queued') {
      schedule(decision.analysisId);
      log.info({ analysisId: decision.analysisId, trigger }, `Queued analysis for ${member.name}`);
    } else {
      log.info({ analysisId: decision.analysisId }, `Skipped analysis for ${member.name} (${decision.reason})`);
    }
    return decision;
  }

  /** Re-queues analyses a previous process left PENDING/RESEARCHING/ANALYZING. */
  async function recoverInterrupted() {
    const interrupted = await repo.findInterruptedAnalyses();
    for (const { id } of interrupted) {
      await repo.updateAnalysis(id, { status: 'PENDING' });
      schedule(id);
    }
    if (interrupted.length > 0) log.info(`Recovered ${interrupted.length} interrupted analysis(es)`);
    return interrupted.length;
  }

  /**
   * Graceful shutdown: start nothing new and give running analyses up to `timeoutMs` to finish.
   * Anything still queued stays PENDING in the database and is recovered on the next start.
   */
  async function drain(timeoutMs) {
    queue.pause();
    if (queue.pending === 0) return true;
    log.info(`Waiting for ${queue.pending} running analysis(es) to finish...`);
    let timer;
    const finished = await Promise.race([
      queue.onPendingZero().then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return finished;
  }

  /** Resolves once the queue is completely empty (used by tests and the dev endpoint). */
  const onIdle = () => queue.onIdle();

  return { enqueue, recoverInterrupted, drain, onIdle, stats: () => ({ queued: queue.size, running: queue.pending }) };
}

export const pipeline = createPipeline({
  repo: analysisRepository,
  research: researchMember,
  analyze: analyzeMember,
  report: postMemberReport,
  canReport: canPostReports,
  concurrency: config.pipeline.concurrency,
  cooldownDays: config.pipeline.cooldownDays,
  logger: logger.child({ module: 'pipeline' }),
});

/** Hook used by the Slack event handlers. */
export const enqueueMemberAnalysis = (ctx) => pipeline.enqueue(ctx);
