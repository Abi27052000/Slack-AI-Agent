import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Keep these tests DB-free: replace the Prisma-backed member service.
vi.mock('../src/services/member.service.js', () => ({
  upsertMemberFromSlack: vi.fn(async (profile) => ({ id: 'member-1', ...profile })),
}));

vi.mock('../src/services/research.service.js', () => ({
  researchMember: vi.fn(async () => ({ sources: [], skipped: [], errors: [], durationMs: 1 })),
}));

const { default: app } = await import('../src/app.js');
const { researchMember } = await import('../src/services/research.service.js');
const { upsertMemberFromSlack } = await import('../src/services/member.service.js');
const { slackUser } = await import('./slack/fixtures.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/dev/slack/events', () => {
  it('processes a simulated team_join', async () => {
    const res = await request(app)
      .post('/api/dev/slack/events')
      .send({ type: 'team_join', user: slackUser() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      event: 'team_join',
      result: { status: 'processed', memberId: 'member-1', trigger: 'team_join' },
    });
    expect(upsertMemberFromSlack).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U012ABC', email: 'jane@acme.io' }),
    );
  });

  it('reports skipped bots', async () => {
    const res = await request(app)
      .post('/api/dev/slack/events')
      .send({ type: 'team_join', user: slackUser({ is_bot: true }) });

    expect(res.body.result).toEqual({ status: 'skipped', reason: 'bot' });
    expect(upsertMemberFromSlack).not.toHaveBeenCalled();
  });

  it('skips member_joined_channel for unwatched channels', async () => {
    const res = await request(app)
      .post('/api/dev/slack/events')
      .send({ type: 'member_joined_channel', user: 'U1', channel: 'C_NOT_WATCHED' });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ status: 'skipped', reason: 'channel_not_watched' });
  });

  it('rejects invalid payloads with details', async () => {
    const res = await request(app).post('/api/dev/slack/events').send({ type: 'team_join' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'user' })]),
    );
  });

  it('rejects unknown event types', async () => {
    const res = await request(app).post('/api/dev/slack/events').send({ type: 'message' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/dev/research', () => {
  it('runs research for the given member', async () => {
    const res = await request(app)
      .post('/api/dev/research')
      .send({ name: 'Jane Doe', email: 'jane@acme.io' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sources: [], skipped: [], errors: [], durationMs: 1 });
    expect(researchMember).toHaveBeenCalledWith({ name: 'Jane Doe', email: 'jane@acme.io' });
  });

  it('requires a name or email', async () => {
    const res = await request(app).post('/api/dev/research').send({});
    expect(res.status).toBe(400);
    expect(researchMember).not.toHaveBeenCalled();
  });

  it('validates the email format', async () => {
    const res = await request(app).post('/api/dev/research').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('email');
  });
});
