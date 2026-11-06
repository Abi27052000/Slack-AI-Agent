import prisma from '../lib/prisma.js';

/**
 * Creates or refreshes a member from a Slack profile (see integrations/slack/profile.js).
 * Keyed on slackUserId, so repeated join events never create duplicates.
 */
export async function upsertMemberFromSlack(profile) {
  // eslint-disable-next-line no-unused-vars
  const { deleted, ...data } = profile;

  return prisma.member.upsert({
    where: { slackUserId: data.slackUserId },
    create: data,
    update: data,
  });
}
