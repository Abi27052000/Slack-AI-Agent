import { describe, it, expect } from 'vitest';
import { toMemberProfile } from '../../src/integrations/slack/profile.js';
import { slackUser } from './fixtures.js';

describe('toMemberProfile', () => {
  it('maps a Slack user to member fields', () => {
    expect(toMemberProfile(slackUser())).toEqual({
      slackUserId: 'U012ABC',
      slackTeamId: 'T0001',
      name: 'Jane Doe',
      username: 'jane',
      email: 'jane@acme.io',
      title: 'Head of Platform',
      timezone: 'Europe/Berlin',
      avatarUrl: 'https://avatars.example/192.png',
      isBot: false,
      deleted: false,
      profile: {
        firstName: 'Jane',
        lastName: 'Doe',
        displayName: 'jane',
        statusText: 'Shipping',
        isAdmin: false,
        isGuest: false,
      },
    });
  });

  it('never keeps sensitive fields like phone numbers', () => {
    expect(JSON.stringify(toMemberProfile(slackUser()))).not.toContain('+49');
  });

  it('falls back through name fields and tolerates a missing profile', () => {
    const result = toMemberProfile({ id: 'U9', name: 'handle' });
    expect(result).toMatchObject({ name: 'handle', email: null, title: null, avatarUrl: null });
    expect(toMemberProfile({ id: 'U9' }).name).toBe('U9');
  });

  it('flags bots, app users and Slackbot', () => {
    expect(toMemberProfile(slackUser({ is_bot: true })).isBot).toBe(true);
    expect(toMemberProfile(slackUser({ is_app_user: true })).isBot).toBe(true);
    expect(toMemberProfile(slackUser({ id: 'USLACKBOT' })).isBot).toBe(true);
  });

  it('marks guests', () => {
    expect(toMemberProfile(slackUser({ is_restricted: true })).profile.isGuest).toBe(true);
  });
});
