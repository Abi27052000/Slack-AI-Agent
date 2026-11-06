import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { slackEventHandlers } from '../integrations/slack/index.js';
import { researchMember } from '../services/research.service.js';

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
