import { describe, it, expect } from 'vitest';
import { ApiError } from '@google/genai';
import { geminiErrorCode, isRetryableGeminiError } from '../../src/integrations/gemini/client.js';

const apiError = (status) => new ApiError({ message: `HTTP ${status}`, status });

describe('isRetryableGeminiError', () => {
  it.each([429, 500, 502, 503, 504, 408])('retries HTTP %s', (status) => {
    expect(isRetryableGeminiError(apiError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404])('does not retry HTTP %s', (status) => {
    expect(isRetryableGeminiError(apiError(status))).toBe(false);
  });

  it('retries invalid model output, timeouts and network failures', () => {
    expect(isRetryableGeminiError({ code: 'INVALID_MODEL_OUTPUT' })).toBe(true);
    expect(isRetryableGeminiError({ code: 'TIMEOUT' })).toBe(true);
    expect(isRetryableGeminiError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableGeminiError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
  });

  it('does not retry unknown errors or missing configuration', () => {
    expect(isRetryableGeminiError(new Error('boom'))).toBe(false);
    expect(isRetryableGeminiError({ code: 'GEMINI_NOT_CONFIGURED' })).toBe(false);
  });
});

describe('geminiErrorCode', () => {
  it.each([
    [400, 'GEMINI_BAD_REQUEST'],
    [401, 'GEMINI_AUTH_FAILED'],
    [403, 'GEMINI_AUTH_FAILED'],
    [404, 'GEMINI_MODEL_NOT_FOUND'],
    [429, 'GEMINI_RATE_LIMITED'],
    [503, 'GEMINI_UNAVAILABLE'],
  ])('maps HTTP %s to %s', (status, code) => {
    expect(geminiErrorCode(apiError(status))).toBe(code);
  });

  it('keeps existing string codes', () => {
    expect(geminiErrorCode({ code: 'TIMEOUT' })).toBe('TIMEOUT');
    expect(geminiErrorCode(new Error('x'))).toBe('GEMINI_ERROR');
  });
});
