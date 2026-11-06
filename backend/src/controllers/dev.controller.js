import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { slackEventHandlers } from '../integrations/slack/index.js';
import { researchMember } from '../services/research.service.js';
import { analyzeMember } from '../services/analysis.service.js';
import { getAnalysisWithMember } from '../services/analysis.repository.js';
import { buildMemberReport } from '../integrations/slack/blocks.js';
import config from '../config/index.js';

function parseOrThrow(schema, body, message) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw AppError.badRequest(
      message,
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}

/** The subset of Slack event payloads our handlers read. */
const slackEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('team_join'),
    user: z.looseObject({ id: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('member_joined_channel'),
    user: z.string().min(1),
    channel: z.string().min(1),
  }),
]);

const handlerByType = {
  team_join: slackEventHandlers.onTeamJoin,
  member_joined_channel: slackEventHandlers.onMemberJoinedChannel,
};

/**
 * POST /api/dev/slack/events: runs a Slack event through the real handlers.
 * Lets you exercise the agent without a Slack workspace (dev/test only).
 */
export const simulateSlackEvent = async (req, res) => {
  const event = parseOrThrow(slackEventSchema, req.body, 'Invalid Slack event payload');
  const result = await handlerByType[event.type](event);
  res.status(200).json({ event: event.type, result });
};

const researchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional(),
  })
  .refine((body) => body.name || body.email, { message: 'Provide a name and/or email' });

/**
 * POST /api/dev/research: runs live research for a made-up member, e.g.
 * { "name": "Jane Doe", "email": "jane@acme.io" }. Nothing is stored.
 */
export const runResearch = async (req, res) => {
  const member = parseOrThrow(researchSchema, req.body, 'Invalid research request');
  res.status(200).json(await researchMember(member));
};

const analyzeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional(),
    title: z.string().trim().max(200).optional(),
    timezone: z.string().trim().max(100).optional(),
    // Supply research to skip the live lookup (handy for repeatable prompt experiments).
    research: z
      .object({
        sources: z.array(z.looseObject({ provider: z.string() })).default([]),
        skipped: z.array(z.looseObject({})).default([]),
        errors: z.array(z.looseObject({})).default([]),
      })
      .optional(),
  })
  .refine((body) => body.name || body.email, { message: 'Provide a name and/or email' });

/**
 * POST /api/dev/analyze: research (unless provided) + Gemini analysis for a made-up member.
 * Nothing is stored or posted. Returns { research, analysis }.
 */
export const runAnalysis = async (req, res) => {
  const { research: providedResearch, ...member } = parseOrThrow(analyzeSchema, req.body, 'Invalid analysis request');
  const research = providedResearch ?? (await researchMember(member));
  const analysis = await analyzeMember(member, research);
  res.status(200).json({ research, analysis });
};

/**
 * GET /api/dev/analyses/:id: a stored analysis plus the Slack report it produces, with a link
 * that opens the report in Slack's Block Kit Builder (no workspace connection needed to preview).
 */
export const getAnalysisPreview = async (req, res) => {
  const record = await getAnalysisWithMember(req.params.id);
  if (!record) throw AppError.notFound(`Analysis ${req.params.id} not found`);

  const { member, ...analysis } = record;
  const report = buildMemberReport({ member, analysis, dashboardUrl: config.pipeline.dashboardUrl });
  const builderPayload = { blocks: report.attachments[0].blocks };

  res.status(200).json({
    analysis,
    member,
    report,
    blockKitBuilderUrl: `https://app.slack.com/block-kit-builder#${encodeURIComponent(JSON.stringify(builderPayload))}`,
  });
};
