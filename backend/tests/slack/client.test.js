import { describe, it, expect, vi } from 'vitest';
import { fetchUserProfile } from '../../src/integrations/slack/client.js';
import { slackUser } from './fixtures.js';

describe('fetchUserProfile', () => {
  it('calls users.info and maps the result', async () => {
    const client = { users: { info: vi.fn().mockResolvedValue({ ok: true, user: slackUser() }) } };

    const profile = await fetchUserProfile(client, 'U012ABC');

    expect(client.users.info).toHaveBeenCalledWith({ user: 'U012ABC' });
    expect(profile).toMatchObject({ slackUserId: 'U012ABC', name: 'Jane Doe' });
  });

  it('throws a descriptive error when Slack returns no user', async () => {
    const client = { users: { info: vi.fn().mockResolvedValue({ ok: false, error: 'user_not_found' }) } };
    await expect(fetchUserProfile(client, 'U404')).rejects.toThrow('users.info failed for U404: user_not_found');
  });
});
