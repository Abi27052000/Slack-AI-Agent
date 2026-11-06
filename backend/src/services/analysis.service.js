import config from '../config/index.js';
import logger from '../lib/logger.js';
import { retry } from '../utils/retry.js';
import { withTimeout } from '../utils/withTimeout.js';
import {
  generateStructured,
  geminiErrorCode,
  isRetryableGeminiError,
} from '../integrations/gemini/client.js';
import { PROMPT_VERSION, buildSystemInstruction, buildUserPrompt } from '../integrations/gemini/prompt.js';
import { analysisJsonSchema, parseAnalysisOutput, tierForScore } from '../integrations/gemini/schema.js';

const log = logger.child({ module: 'analysis' });

/**
 * Result stored when the model can't produce an analysis. Unlike the reference project (which
 * silently stored a score of 50), the score is left empty and the record is flagged for review.
 */
function fallbackAnalysis({ code, message, attempts, model, durationMs }) {
  return {
    fitScore: null,
    tier: null,
    confidence: 'low',
    summary: 'Automatic analysis was not available. Manual review needed.',
    insights: [],
    recommendations: ['Review this member manually'],
    isFallback: true,
    error: { code, message },
    model,
    promptVersion: PROMPT_VERSION,
    attempts,
    usage: null,
    durationMs,
  };
}

/**
 * Scores a member's product fit with Gemini, based on their profile and research findings.
 * Never throws: on failure it returns a fallback result with `isFallback: true` and an error code.
 *
 * @param {object} member   { name, email, title, timezone }
 * @param {object} research result of researchMember() ({ sources, skipped, errors })
 * @param {object} [deps]   injectable for tests
 */
export async function analyzeMember(
  member,
  research,
  {
    generate = generateStructured,
    enabled = config.gemini.enabled,
    model = config.gemini.model,
    company = config.company,
    timeoutMs = config.gemini.timeoutMs,
    retries = config.gemini.maxRetries,
    sleep,
  } = {},
) {
  const started = Date.now();

  if (!enabled) {
    return fallbackAnalysis({
      code: 'GEMINI_NOT_CONFIGURED',
      message: 'GEMINI_API_KEY is not set',
      attempts: 0,
      model,
      durationMs: 0,
    });
  }

  const systemInstruction = buildSystemInstruction(company);
  const prompt = buildUserPrompt(member, research);

  try {
    const { value, attempts } = await retry(
      async () => {
        const { text, usage } = await withTimeout(
          (signal) => generate({ systemInstruction, prompt, jsonSchema: analysisJsonSchema, signal, model }),
          timeoutMs,
          'Gemini analysis',
        );
        return { output: parseAnalysisOutput(text), usage };
      },
      {
        retries,
        sleep,
        shouldRetry: isRetryableGeminiError,
        onRetry: ({ attempt, delayMs, error }) =>
          log.warn(`Gemini attempt ${attempt} failed (${geminiErrorCode(error)}), retrying in ${delayMs}ms`),
      },
    );

    const { output, usage } = value;
    const result = {
      fitScore: output.fitScore,
      tier: tierForScore(output.fitScore),
      confidence: output.confidence,
      summary: output.summary,
      insights: output.insights,
      recommendations: output.recommendations,
      isFallback: false,
      error: null,
      model,
      promptVersion: PROMPT_VERSION,
      attempts,
      usage,
      durationMs: Date.now() - started,
    };

    log.info(
      { member: member.name, fitScore: result.fitScore, tier: result.tier, attempts, durationMs: result.durationMs, usage },
      `Analysis complete: ${result.fitScore}/100 (${result.tier})`,
    );
    return result;
  } catch (err) {
    const code = geminiErrorCode(err);
    log.error({ member: member.name, code, attempts: err.attempts, details: err.details }, `Analysis failed: ${err.message}`);
    return fallbackAnalysis({
      code,
      message: err.message,
      attempts: err.attempts ?? 1,
      model,
      durationMs: Date.now() - started,
    });
  }
}
