import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { slackEventHandlers } from '../integrations/slack/index.js';

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
  const parsed = slackEventSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(
      'Invalid Slack event payload',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  const event = parsed.data;
  const result = await handlerByType[event.type](event);
  res.status(200).json({ event: event.type, result });
};
