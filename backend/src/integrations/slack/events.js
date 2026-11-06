import { toMemberProfile } from './profile.js';

/**
 * Builds the Slack event handlers. Dependencies are injected so the handlers can be
 * unit-tested and driven by the dev simulation endpoint without a real Slack connection.
 *
 * Each handler resolves to a result object describing what happened:
 *   { status: 'processed', memberId, trigger, analysis? } | { status: 'skipped', reason }
 *
 * @param {object} deps
 * @param {(profile) => Promise<{id: string}>} deps.upsertMember   persist the member
 * @param {(userId: string) => Promise<object>} deps.fetchUserProfile  users.info lookup
 * @param {string[]} deps.watchChannelIds   channels whose joins we react to
 * @param {() => string|null} deps.getBotUserId  the agent's own Slack user id
 * @param {(ctx) => Promise<object>} [deps.onMemberJoined]  hands the member to the analysis pipeline
 * @param {import('pino').Logger} deps.logger
 */
export function createEventHandlers({
  upsertMember,
  fetchUserProfile,
  watchChannelIds,
  getBotUserId,
  onMemberJoined,
  logger,
}) {
  const watched = new Set(watchChannelIds);

  function skipReason(profile) {
    if (profile.slackUserId === getBotUserId()) return 'self';
    if (profile.isBot) return 'bot';
    if (profile.deleted) return 'deleted';
    return null;
  }

  async function processMember(profile, context) {
    const reason = skipReason(profile);
    if (reason) {
      logger.debug(`Skipping ${profile.slackUserId} (${reason}) from ${context.trigger}`);
      return { status: 'skipped', reason };
    }

    const member = await upsertMember(profile);
    logger.info(
      { memberId: member.id, slackUserId: profile.slackUserId, trigger: context.trigger },
      `Member joined: ${profile.name}`,
    );

    const result = { status: 'processed', memberId: member.id, trigger: context.trigger };
    if (onMemberJoined) {
      // e.g. { status: 'queued', analysisId } or { status: 'skipped', reason: 'recently_analyzed' }
      result.analysis = (await onMemberJoined({ member, ...context })) ?? null;
    }
    return result;
  }

  /** `team_join`: someone joined the workspace. The payload already contains the full user. */
  async function onTeamJoin(event) {
    return processMember(toMemberProfile(event.user), { trigger: 'team_join' });
  }

  /**
   * `member_joined_channel`: only watched channels count. This replaces the reference project's
   * `channel_type === 'C'` check, which matched every public channel in the workspace.
   */
  async function onMemberJoinedChannel(event) {
    if (!watched.has(event.channel)) {
      return { status: 'skipped', reason: 'channel_not_watched' };
    }
    // Avoid a users.info call when the bot itself is added to a channel.
    if (event.user === getBotUserId()) {
      return { status: 'skipped', reason: 'self' };
    }

    const profile = await fetchUserProfile(event.user);
    return processMember(profile, { trigger: 'member_joined_channel', channelId: event.channel });
  }

  return { onTeamJoin, onMemberJoinedChannel };
}
