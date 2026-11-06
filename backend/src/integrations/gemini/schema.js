import { z } from 'zod';

/**
 * Shape of the model's answer. One zod schema is the single source of truth: it is converted to
 * JSON Schema for Gemini's structured output (`responseJsonSchema`) and used again to validate the
 * response, so a malformed answer can never reach the database or Slack.
 */
export const analysisOutputSchema = z.object({
  fitScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('0-100 likelihood this member is a good prospect for the product'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('How much evidence supports the score; "low" when little is known about the member'),
  summary: z.string().min(1).max(400).describe('One or two sentences explaining the score'),
  insights: z
    .array(z.string().min(1).max(300))
    .min(1)
    .max(5)
    .describe('3-5 concrete observations grounded in the provided data'),
  recommendations: z
    .array(z.string().min(1).max(300))
    .min(1)
    .max(4)
    .describe('2-4 specific next steps for engaging this member'),
});

/** Keywords left out of the schema sent to Gemini (zod still enforces them on the response). */
const UNSENT_KEYWORDS = new Set(['$schema', 'minLength', 'maxLength']);

function stripKeywords(node) {
  if (Array.isArray(node)) return node.map(stripKeywords);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !UNSENT_KEYWORDS.has(key))
      .map(([key, value]) => [key, key === 'properties' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripKeywords(v)])) : stripKeywords(value)]),
  );
}

function toGeminiJsonSchema(schema) {
  return stripKeywords(z.toJSONSchema(schema));
}

export const analysisJsonSchema = toGeminiJsonSchema(analysisOutputSchema);

/** Raised when the model's text isn't valid JSON or doesn't match the schema (retryable). */
export class InvalidModelOutputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'InvalidModelOutputError';
    this.code = 'INVALID_MODEL_OUTPUT';
    this.details = details;
  }
}

/** Parses and validates raw model text against the analysis schema. */
export function parseAnalysisOutput(text) {
  if (!text) throw new InvalidModelOutputError('Model returned an empty response');

  let data;
  try {
    // Structured output returns bare JSON, but tolerate a stray ```json fence just in case.
    data = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new InvalidModelOutputError('Model response is not valid JSON', text.slice(0, 200));
  }

  const result = analysisOutputSchema.safeParse(data);
  if (!result.success) {
    throw new InvalidModelOutputError(
      'Model response does not match the analysis schema',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

/** Score bucket, derived in code (not trusted from the model). Matches the FitTier enum. */
export function tierForScore(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return 'HOT';
  if (score >= 60) return 'WARM';
  if (score >= 40) return 'COOL';
  return 'COLD';
}
