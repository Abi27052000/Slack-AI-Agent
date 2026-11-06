import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { createEventHandlers } from '../../src/integrations/slack/events.js';
import { toMemberProfile } from '../../src/integrations/slack/profile.js';
import { slackUser } from './fixtures.js';

const WATCHED = 'C_WATCHED';
const BOT_ID = 'U_AGENT';

let deps;
let handlers;

beforeEach(() => {
  deps = {
    upsertMember: vi.fn(async (profile) => ({ id: `member-${profile.slackUserId}` })),
    fetchUserProfile: vi.fn(async (userId) => toMemberProfile(slackUser({ id: userId }))),
    watchChannelIds: [WATCHED],
    getBotUserId: () => BOT_ID,
    onMemberJoined: vi.fn(async () => ({ status: 'queued', analysisId: 'a1' })),
    logger: pino({ level: 'silent' }),
  };
  handlers = createEventHandlers(deps);
});

describe('onTeamJoin', () => {
  it('upserts the member from the event payload without calling users.info', async () => {
    const result = await handlers.onTeamJoin({ type: 'team_join', user: slackUser() });

    expect(result).toEqual({
      status: 'processed',
      memberId: 'member-U012ABC',
      trigger: 'team_join',
      analysis: { status: 'queued', analysisId: 'a1' },
    });
    expect(deps.fetchUserProfile).not.toHaveBeenCalled();
    expect(deps.upsertMember).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U012ABC', email: 'jane@acme.io' }),
    );
    expect(deps.onMemberJoined).toHaveBeenCalledWith(
      expect.objectContaining({ member: { id: 'member-U012ABC' }, trigger: 'team_join' }),
    );
  });

  it.each([
    ['bot', { is_bot: true }],
    ['deleted', { deleted: true }],
    ['self', { id: BOT_ID }],
  ])('skips %s users', async (reason, overrides) => {
    const result = await handlers.onTeamJoin({ type: 'team_join', user: slackUser(overrides) });

    expect(result).toEqual({ status: 'skipped', reason });
    expect(deps.upsertMember).not.toHaveBeenCalled();
    expect(deps.onMemberJoined).not.toHaveBeenCalled();
  });
});

describe('onMemberJoinedChannel', () => {
  const event = (overrides = {}) => ({
    type: 'member_joined_channel',
    user: 'U777',
    channel: WATCHED,
    channel_type: 'C',
    ...overrides,
  });

  it('fetches the profile and processes joins to a watched channel', async () => {
    const result = await handlers.onMemberJoinedChannel(event());

    expect(deps.fetchUserProfile).toHaveBeenCalledWith('U777');
    expect(result).toMatchObject({ status: 'processed', trigger: 'member_joined_channel' });
    expect(deps.onMemberJoined).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: WATCHED, trigger: 'member_joined_channel' }),
    );
  });

  it('ignores channels that are not watched (even public ones)', async () => {
    const result = await handlers.onMemberJoinedChannel(event({ channel: 'C_RANDOM' }));

    expect(result).toEqual({ status: 'skipped', reason: 'channel_not_watched' });
    expect(deps.fetchUserProfile).not.toHaveBeenCalled();
  });

  it('skips the bot being added to a channel without an API call', async () => {
    const result = await handlers.onMemberJoinedChannel(event({ user: BOT_ID }));

    expect(result).toEqual({ status: 'skipped', reason: 'self' });
    expect(deps.fetchUserProfile).not.toHaveBeenCalled();
  });

  it('propagates users.info failures to the caller', async () => {
    deps.fetchUserProfile.mockRejectedValue(new Error('users.info failed: user_not_found'));
    await expect(handlers.onMemberJoinedChannel(event())).rejects.toThrow('user_not_found');
  });
});

describe('without an onMemberJoined hook', () => {
  it('still upserts the member', async () => {
    handlers = createEventHandlers({ ...deps, onMemberJoined: undefined });
    const result = await handlers.onTeamJoin({ type: 'team_join', user: slackUser() });
    expect(result.status).toBe('processed');
  });
});
