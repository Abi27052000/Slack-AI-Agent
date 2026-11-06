import { describe, it, expect } from 'vitest';
import {
  InvalidModelOutputError,
  analysisJsonSchema,
  parseAnalysisOutput,
  tierForScore,
} from '../../src/integrations/gemini/schema.js';
import { validOutput } from './fixtures.js';

describe('analysisJsonSchema', () => {
  it('is plain JSON Schema with every field required and no extra properties', () => {
    expect(analysisJsonSchema).toMatchObject({
      type: 'object',
      required: ['fitScore', 'confidence', 'summary', 'insights', 'recommendations'],
      additionalProperties: false,
      properties: {
        fitScore: { type: 'integer', minimum: 0, maximum: 100 },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        insights: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
      },
    });
  });

  it('omits keywords Gemini may not support', () => {
    const json = JSON.stringify(analysisJsonSchema);
    expect(json).not.toContain('$schema');
    expect(json).not.toContain('minLength');
    expect(json).not.toContain('maxLength');
  });
});

describe('parseAnalysisOutput', () => {
  it('parses valid JSON output', () => {
    expect(parseAnalysisOutput(JSON.stringify(validOutput))).toEqual(validOutput);
  });

  it('tolerates a markdown code fence', () => {
    expect(parseAnalysisOutput(`\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``)).toEqual(validOutput);
  });

  it.each([
    ['empty', undefined, 'empty response'],
    ['not JSON', 'Sure! Here is the analysis…', 'not valid JSON'],
    ['score out of range', JSON.stringify({ ...validOutput, fitScore: 140 }), 'does not match'],
    ['non-integer score', JSON.stringify({ ...validOutput, fitScore: 72.5 }), 'does not match'],
    ['missing field', JSON.stringify({ ...validOutput, summary: undefined }), 'does not match'],
    ['too many insights', JSON.stringify({ ...validOutput, insights: Array(6).fill('x') }), 'does not match'],
    ['bad confidence', JSON.stringify({ ...validOutput, confidence: 'certain' }), 'does not match'],
    ['summary too long', JSON.stringify({ ...validOutput, summary: 'x'.repeat(401) }), 'does not match'],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseAnalysisOutput(text)).toThrow(InvalidModelOutputError);
    expect(() => parseAnalysisOutput(text)).toThrow(message);
  });

  it('reports which fields were invalid', () => {
    try {
      parseAnalysisOutput(JSON.stringify({ ...validOutput, fitScore: -1 }));
    } catch (err) {
      expect(err.code).toBe('INVALID_MODEL_OUTPUT');
      expect(err.details[0]).toMatch(/^fitScore:/);
    }
  });
});

describe('tierForScore', () => {
  it.each([
    [100, 'HOT'], [80, 'HOT'], [79, 'WARM'], [60, 'WARM'], [59, 'COOL'], [40, 'COOL'], [39, 'COLD'], [0, 'COLD'],
    [null, null], [undefined, null],
  ])('%s -> %s', (score, tier) => {
    expect(tierForScore(score)).toBe(tier);
  });
});
