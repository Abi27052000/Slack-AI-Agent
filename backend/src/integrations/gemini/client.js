import { ApiError, GoogleGenAI } from '@google/genai';
import config from '../../config/index.js';

let client = null;

function getClient() {
  if (!config.gemini.apiKey) {
    throw Object.assign(new Error('GEMINI_API_KEY is not set'), { code: 'GEMINI_NOT_CONFIGURED' });
  }
  client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

/** HTTP statuses worth retrying: rate limits and transient server errors. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableGeminiError(err) {
  if (err?.code === 'INVALID_MODEL_OUTPUT') return true; // model nondeterminism: try again
  if (err?.code === 'TIMEOUT') return true;
  if (err instanceof ApiError || typeof err?.status === 'number') return RETRYABLE_STATUSES.has(err.status);
  // fetch-level network failures ("fetch failed", ECONNRESET, ...)
  return err?.name === 'TypeError' || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.code);
}

/** Stable error codes for the stored analysis / logs. */
export function geminiErrorCode(err) {
  if (err?.code && typeof err.code === 'string') return err.code;
  switch (err?.status) {
    case 400:
      return 'GEMINI_BAD_REQUEST';
    case 401:
    case 403:
      return 'GEMINI_AUTH_FAILED';
    case 404:
      return 'GEMINI_MODEL_NOT_FOUND';
    case 429:
      return 'GEMINI_RATE_LIMITED';
    default:
      return err?.status >= 500 ? 'GEMINI_UNAVAILABLE' : 'GEMINI_ERROR';
  }
}

/**
 * One structured-output call. Returns the raw JSON text plus token usage.
 * @returns {Promise<{ text: string|undefined, usage: object|null }>}
 */
export async function generateStructured({ systemInstruction, prompt, jsonSchema, signal, model = config.gemini.model }) {
  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      // No maxOutputTokens: on thinking models it also caps reasoning tokens, and a truncated
      // answer is invalid JSON. Output length is bounded by the schema's maxLength/maxItems instead.
      abortSignal: signal,
    },
  });

  const usage = response.usageMetadata
    ? {
        promptTokens: response.usageMetadata.promptTokenCount ?? null,
        outputTokens: response.usageMetadata.candidatesTokenCount ?? null,
        thinkingTokens: response.usageMetadata.thoughtsTokenCount ?? null,
        totalTokens: response.usageMetadata.totalTokenCount ?? null,
      }
    : null;

  return { text: response.text, usage };
}

/**
 * Startup check: confirms the API key works and the configured model exists, so a typo in
 * GEMINI_MODEL or a revoked key shows up immediately instead of on the first member join.
 */
export async function verifyGeminiModel(model = config.gemini.model) {
  try {
    const info = await getClient().models.get({ model });
    return { model, displayName: info.displayName ?? model };
  } catch (err) {
    const code = geminiErrorCode(err);
    const hint = {
      GEMINI_AUTH_FAILED: 'Check GEMINI_API_KEY.',
      GEMINI_BAD_REQUEST: 'Check GEMINI_API_KEY.',
      GEMINI_MODEL_NOT_FOUND: `Model "${model}" not found. Check GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models.`,
    }[code];
    throw Object.assign(new Error(`Gemini verification failed (${code}). ${hint ?? err.message}`), {
      code,
      fatal: Boolean(hint),
      cause: err,
    });
  }
}
