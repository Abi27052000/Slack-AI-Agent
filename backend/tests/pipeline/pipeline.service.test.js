import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { createPipeline } from '../../src/services/pipeline.service.js';

const IN_FLIGHT = ['PENDING', 'RESEARCHING', 'ANALYZING'];
const member = { id: 'm1', name: 'Jane Doe', email: 'jane@acme.io', slackUserId: 'U1' };

/** In-memory stand-in for analysis.repository.js, with the same blocking rules. */
function createFakeRepo() {
  const rows = new Map();
  const history = new Map(); // id -> list of statuses
  let seq = 0;

  return {
    rows,
    history,
    findBlockingAnalysis: vi.fn(async (memberId, { cooldownSince, inFlightSince }) =>
      [...rows.values()]
        .filter((r) => r.memberId === memberId)
        .filter(
          (r) =>
            (cooldownSince && ['ANALYZED', 'POSTED'].includes(r.status) && !r.isFallback && r.createdAt >= cooldownSince) ||
            (IN_FLIGHT.includes(r.status) && r.createdAt >= inFlightSince),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    ),
    createPendingAnalysis: vi.fn(async ({ memberId, trigger, triggerChannelId }) => {
      const id = `a${++seq}`;
      rows.set(id, { id, memberId, trigger, triggerChannelId, status: 'PENDING', isFallback: false, createdAt: new Date() });
      history.set(id, ['PENDING']);
      return { id };
    }),
    updateAnalysis: vi.fn(async (id, data) => {
      const row = { ...rows.get(id), ...data };
      rows.set(id, row);
      if (data.status) history.get(id).push(data.status);
      return row;
    }),
    getAnalysisWithMember: vi.fn(async (id) => (rows.has(id) ? { ...rows.get(id), member } : null)),
    findInterruptedAnalyses: vi.fn(async () => [...rows.values()].filter((r) => IN_FLIGHT.includes(r.status))),
  };
}

const research = { sources: [{ provider: 'company_website', url: 'https://acme.io', title: 'Acme' }], skipped: [], errors: [] };
const analysisResult = {
  fitScore: 82,
  tier: 'HOT',
  confidence: 'high',
  summary: 'Great fit',
  insights: ['a'],
  recommendations: ['b'],
  isFallback: false,
  error: null,
  model: 'gemini-test',
  promptVersion: 'member-fit-v1',
  attempts: 1,
  usage: { totalTokens: 100 },
  durationMs: 5,
};

let repo;
let deps;

function makePipeline(overrides = {}) {
  repo = createFakeRepo();
  deps = {
    repo,
    research: vi.fn(async () => research),
    analyze: vi.fn(async () => analysisResult),
    report: vi.fn(async () => ({ channel: 'C_REPORTS', ts: '1700000000.000100' })),
    canReport: vi.fn(() => true),
    concurrency: 2,
    cooldownDays: 30,
    logger: pino({ level: 'silent' }),
    ...overrides,
  };
  return createPipeline(deps);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pipeline: happy path', () => {
  it('researches, analyses, stores and posts, persisting every status', async () => {
    const pipeline = makePipeline();

    const decision = await pipeline.enqueue({ member, trigger: 'member_joined_channel', channelId: 'C_WELCOME' });
    expect(decision).toEqual({ status: 'queued', analysisId: 'a1' });

    await pipeline.onIdle();

    expect(repo.history.get('a1')).toEqual(['PENDING', 'RESEARCHING', 'ANALYZING', 'ANALYZED', 'POSTED']);
    expect(repo.rows.get('a1')).toMatchObject({
      triggerChannelId: 'C_WELCOME',
      fitScore: 82,
      tier: 'HOT',
      confidence: 'high',
      researchData: research,
      usage: { totalTokens: 100 },
      error: null,
      slackChannelId: 'C_REPORTS',
      slackMessageTs: '1700000000.000100',
      postedAt: expect.any(Date),
      completedAt: expect.any(Date),
      durationMs: expect.any(Number),
    });
    expect(deps.analyze).toHaveBeenCalledWith(member, research);
    expect(deps.report).toHaveBeenCalledWith({
      member,
      analysis: expect.objectContaining({ id: 'a1', fitScore: 82, researchData: research }),
    });
  });

  it('stores but does not post when Slack reporting is not configured', async () => {
    const pipeline = makePipeline({ canReport: () => false });
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect(repo.rows.get('a1').status).toBe('ANALYZED');
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('stores the fallback error code when Gemini was unavailable', async () => {
    const pipeline = makePipeline({
      analyze: vi.fn(async () => ({
        ...analysisResult,
        fitScore: null,
        tier: null,
        isFallback: true,
        error: { code: 'GEMINI_RATE_LIMITED', message: 'quota' },
      })),
    });
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect(repo.rows.get('a1')).toMatchObject({ status: 'POSTED', isFallback: true, error: 'GEMINI_RATE_LIMITED: quota' });
  });
});

describe('pipeline: failures', () => {
  it('keeps the analysis (ANALYZED) and records the reason when posting to Slack fails', async () => {
    const slackError = Object.assign(new Error('An API error occurred: not_in_channel'), { data: { error: 'not_in_channel' } });
    const pipeline = makePipeline({ report: vi.fn().mockRejectedValue(slackError) });

    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect(repo.rows.get('a1')).toMatchObject({ status: 'ANALYZED', fitScore: 82, error: 'SLACK_POST_FAILED: not_in_channel' });
  });

  it('marks the analysis FAILED with the error when a step throws', async () => {
    const pipeline = makePipeline({ research: vi.fn().mockRejectedValue(new Error('database exploded')) });

    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect(repo.history.get('a1')).toEqual(['PENDING', 'RESEARCHING', 'FAILED']);
    expect(repo.rows.get('a1').error).toBe('PIPELINE_ERROR: database exploded');
    expect(deps.analyze).not.toHaveBeenCalled();
  });
});

describe('pipeline: duplicate protection', () => {
  it('skips members analysed within the cooldown window', async () => {
    const pipeline = makePipeline();
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect(await pipeline.enqueue({ member, trigger: 'member_joined_channel' })).toEqual({
      status: 'skipped',
      reason: 'recently_analyzed',
      analysisId: 'a1',
    });
    expect(deps.research).toHaveBeenCalledTimes(1);
  });

  it('re-analyses once the cooldown has passed', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const pipeline = makePipeline({ now: () => clock, cooldownDays: 30 });
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();
    repo.rows.get('a1').createdAt = clock;

    clock = new Date('2026-02-15T00:00:00Z');
    expect((await pipeline.enqueue({ member, trigger: 'team_join' })).status).toBe('queued');
  });

  it('only analyses once when two join events arrive at the same time', async () => {
    const pipeline = makePipeline();
    const [first, second] = await Promise.all([
      pipeline.enqueue({ member, trigger: 'team_join' }),
      pipeline.enqueue({ member, trigger: 'member_joined_channel', channelId: 'C1' }),
    ]);

    expect(first.status).toBe('queued');
    expect(second).toMatchObject({ status: 'skipped', reason: 'analysis_in_progress', analysisId: first.analysisId });
    await pipeline.onIdle();
    expect(deps.research).toHaveBeenCalledTimes(1);
  });

  it('retries members whose last analysis failed or fell back', async () => {
    const pipeline = makePipeline({ analyze: vi.fn(async () => ({ ...analysisResult, isFallback: true })) });
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect((await pipeline.enqueue({ member, trigger: 'team_join' })).status).toBe('queued');
  });

  it('can be forced past the duplicate check', async () => {
    const pipeline = makePipeline();
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await pipeline.onIdle();

    expect((await pipeline.enqueue({ member, trigger: 'manual', force: true })).status).toBe('queued');
  });

  it('never runs two analyses for a member at once, even when forced', async () => {
    const pipeline = makePipeline();
    const first = await pipeline.enqueue({ member, trigger: 'manual', force: true });
    const second = await pipeline.enqueue({ member, trigger: 'manual', force: true });

    expect(second).toEqual({ status: 'skipped', reason: 'analysis_in_progress', analysisId: first.analysisId });
    await pipeline.onIdle();
    expect(deps.research).toHaveBeenCalledTimes(1);
  });
});

describe('pipeline: queue', () => {
  it('limits how many analyses run at once', async () => {
    let running = 0;
    let peak = 0;
    const pipeline = makePipeline({
      concurrency: 2,
      research: vi.fn(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
        return research;
      }),
    });

    for (let i = 0; i < 5; i += 1) {
      await pipeline.enqueue({ member: { ...member, id: `m${i}` }, trigger: 'team_join' });
    }
    await pipeline.onIdle();

    expect(deps.research).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it('recovers analyses interrupted by a previous process', async () => {
    const pipeline = makePipeline();
    repo.rows.set('old', { id: 'old', memberId: 'm1', status: 'ANALYZING', createdAt: new Date() });
    repo.history.set('old', ['ANALYZING']);

    expect(await pipeline.recoverInterrupted()).toBe(1);
    await pipeline.onIdle();

    expect(repo.history.get('old')).toEqual(['ANALYZING', 'PENDING', 'RESEARCHING', 'ANALYZING', 'ANALYZED', 'POSTED']);
  });

  it('drain waits for running analyses and leaves queued ones for recovery', async () => {
    let release;
    const pipeline = makePipeline({
      concurrency: 1,
      research: vi.fn(() => new Promise((resolve) => {
        release = () => resolve(research);
      })),
    });

    await pipeline.enqueue({ member: { ...member, id: 'x1' }, trigger: 'team_join' });
    await pipeline.enqueue({ member: { ...member, id: 'x2' }, trigger: 'team_join' });
    await vi.waitFor(() => expect(deps.research).toHaveBeenCalledTimes(1));

    const draining = pipeline.drain(1_000);
    release();
    expect(await draining).toBe(true);

    expect(repo.rows.get('a1').status).toBe('POSTED');
    expect(repo.rows.get('a2').status).toBe('PENDING'); // never started: recovered on next boot
  });

  it('drain gives up after the timeout', async () => {
    const pipeline = makePipeline({ research: vi.fn(() => new Promise(() => {})) });
    await pipeline.enqueue({ member, trigger: 'team_join' });
    await vi.waitFor(() => expect(deps.research).toHaveBeenCalled());

    expect(await pipeline.drain(20)).toBe(false);
  });
});
