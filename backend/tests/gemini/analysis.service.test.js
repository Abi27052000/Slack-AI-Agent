import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@google/genai';
import { analyzeMember } from '../../src/services/analysis.service.js';
import { PROMPT_VERSION } from '../../src/integrations/gemini/prompt.js';
import { validOutput } from './fixtures.js';

const member = { name: 'Jane Doe', email: 'jane@acme.io', title: 'Head of Platform' };
const research = { sources: [], skipped: [], errors: [] };
const usage = { promptTokens: 900, outputTokens: 120, thinkingTokens: 300, totalTokens: 1320 };

const reply = (body) => async () => ({ text: typeof body === 'string' ? body : JSON.stringify(body), usage });

function run(generate, overrides = {}) {
  return analyzeMember(member, research, {
    generate: vi.isMockFunction(generate) ? generate : vi.fn(generate),
    enabled: true,
    model: 'gemini-test',
    company: { name: 'Acme', product: 'Acme Cloud' },
    timeoutMs: 1_000,
    retries: 2,
    sleep: async () => {},
    ...overrides,
  });
}

describe('analyzeMember', () => {
  it('returns a validated analysis with a derived tier', async () => {
    const generate = vi.fn(reply(validOutput));
    const result = await run(generate);

    expect(result).toMatchObject({
      fitScore: 82,
      tier: 'HOT',
      confidence: 'medium',
      summary: validOutput.summary,
      insights: validOutput.insights,
      recommendations: validOutput.recommendations,
      isFallback: false,
      error: null,
      model: 'gemini-test',
      promptVersion: PROMPT_VERSION,
      attempts: 1,
      usage,
    });

    const call = generate.mock.calls[0][0];
    expect(call.systemInstruction).toContain('Acme Cloud');
    expect(call.prompt).toContain('"name": "Jane Doe"');
    expect(call.jsonSchema.required).toContain('fitScore');
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call.model).toBe('gemini-test');
  });

  it('retries when the model returns invalid output, then succeeds', async () => {
    const generate = vi
      .fn()
      .mockImplementationOnce(reply('not json'))
      .mockImplementationOnce(reply({ ...validOutput, fitScore: 500 }))
      .mockImplementation(reply(validOutput));

    const result = await run(generate);
    expect(result).toMatchObject({ isFallback: false, attempts: 3, fitScore: 82 });
  });

  it('retries rate limits and transient errors', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'quota', status: 429 }))
      .mockImplementation(reply(validOutput));

    expect(await run(generate)).toMatchObject({ isFallback: false, attempts: 2 });
  });

  it('falls back without retrying on auth errors', async () => {
    const generate = vi.fn().mockRejectedValue(new ApiError({ message: 'API key not valid', status: 400 }));
    const result = await run(generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      isFallback: true,
      fitScore: null,
      tier: null,
      error: { code: 'GEMINI_BAD_REQUEST', message: 'API key not valid' },
      attempts: 1,
    });
  });

  it('falls back after exhausting retries on persistent bad output', async () => {
    const generate = vi.fn(reply({ nope: true }));
    const result = await run(generate);

    expect(generate).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(result).toMatchObject({ isFallback: true, error: { code: 'INVALID_MODEL_OUTPUT' }, attempts: 3 });
    expect(result.recommendations).toEqual(['Review this member manually']);
  });

  it('times out hung calls and retries them', async () => {
    const generate = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(reply(validOutput));

    const result = await run(generate, { timeoutMs: 20 });
    expect(result).toMatchObject({ isFallback: false, attempts: 2 });
  });

  it('returns a fallback without calling Gemini when no API key is configured', async () => {
    const generate = vi.fn();
    const result = await run(generate, { enabled: false });

    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isFallback: true, attempts: 0, error: { code: 'GEMINI_NOT_CONFIGURED' } });
  });
});
