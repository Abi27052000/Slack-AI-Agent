import { describe, it, expect } from 'vitest';
import { buildMemberReport, escapeMrkdwn, truncate } from '../../src/integrations/slack/blocks.js';

const member = { name: 'Jane Doe', title: 'Head of Platform', email: 'jane@acme.io', slackUserId: 'U012ABC' };
const analysis = {
  id: 'a1',
  trigger: 'member_joined_channel',
  triggerChannelId: 'C_WELCOME',
  fitScore: 82,
  tier: 'HOT',
  confidence: 'high',
  summary: 'Strong ICP match.',
  insights: ['Senior platform leader', 'Company sells APIs'],
  recommendations: ['Invite to beta'],
  isFallback: false,
  error: null,
  model: 'gemini-3.6-flash',
  promptVersion: 'member-fit-v1',
  durationMs: 10_400,
  researchData: {
    sources: [
      { provider: 'company_website', url: 'https://acme.io/', title: 'Acme', confidence: 'high' },
      { provider: 'github', url: 'https://github.com/janedoe', title: 'GitHub: janedoe', confidence: 'medium' },
    ],
  },
};

const blocksOf = (report) => report.attachments[0].blocks;
const allText = (report) => JSON.stringify(blocksOf(report));
/** Everything Slack parses as mrkdwn (the header is plain_text, which Slack never parses). */
const mrkdwnText = (report) => JSON.stringify(blocksOf(report).slice(1));

describe('buildMemberReport', () => {
  it('builds a coloured report with score, profile and findings', () => {
    const report = buildMemberReport({ member, analysis, dashboardUrl: 'https://dash.example' });

    expect(report.text).toBe('New member analysis: Jane Doe (82/100)');
    expect(report.attachments[0].color).toBe('#2EB67D');

    const blocks = blocksOf(report);
    expect(blocks[0]).toEqual({ type: 'header', text: { type: 'plain_text', text: '🔍 New member: Jane Doe', emoji: true } });
    expect(blocks[1].fields.map((f) => f.text)).toEqual([
      '*Fit score*\n🔥 *82/100* · Hot',
      '*Confidence*\nhigh',
      '*Title*\nHead of Platform',
      '*Email*\njane@acme.io',
      '*Profile*\n<@U012ABC>',
      '*Trigger*\nJoined <#C_WELCOME>',
    ]);

    const text = allText(report);
    expect(text).toContain('Strong ICP match.');
    expect(text).toContain('• Senior platform leader');
    expect(text).toContain('<https://acme.io/|Acme> _(high confidence)_');
    expect(text).toContain('gemini-3.6-flash · member-fit-v1 · analysed in 10.4s');
    expect(text).toContain('<https://dash.example/analyses/a1|View in dashboard>');
  });

  it.each([
    ['WARM', '#ECB22E', '☀️'],
    ['COOL', '#F2952F', '🌤️'],
    ['COLD', '#E01E5A', '❄️'],
  ])('styles %s members', (tier, color, emoji) => {
    const report = buildMemberReport({ member, analysis: { ...analysis, tier } });
    expect(report.attachments[0].color).toBe(color);
    expect(blocksOf(report)[1].fields[0].text).toContain(emoji);
  });

  it('flags fallback analyses for manual review', () => {
    const report = buildMemberReport({
      member,
      analysis: {
        ...analysis,
        fitScore: null,
        tier: null,
        isFallback: true,
        summary: 'Automatic analysis was not available.',
        insights: [],
        recommendations: ['Review this member manually'],
        error: 'GEMINI_RATE_LIMITED: quota exceeded',
      },
    });

    expect(report.text).toContain('(n/a)');
    expect(report.attachments[0].color).toBe('#9E9EA6');
    expect(allText(report)).toContain('Automatic analysis unavailable (GEMINI_RATE_LIMITED)');
    expect(allText(report)).not.toContain('*Insights*');
  });

  it('escapes member-controlled text so it cannot ping channels or inject links', () => {
    const report = buildMemberReport({
      member: { ...member, name: 'Eve <!channel>', title: '<https://evil.example|Click me> & co' },
      analysis: { ...analysis, insights: ['<!here> urgent'] },
    });
    const text = mrkdwnText(report);

    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<!here>');
    expect(text).toContain('&lt;https://evil.example|Click me&gt; &amp; co');
    // The header is plain_text (Slack doesn't parse it), so it is left as-is.
    expect(blocksOf(report)[0].text.text).toBe('🔍 New member: Eve <!channel>');
  });

  it('only renders http(s) source links', () => {
    const report = buildMemberReport({
      member,
      analysis: { ...analysis, researchData: { sources: [{ url: 'javascript:alert(1)', title: 'Bad' }, { url: 'not a url', title: 'Worse' }] } },
    });
    const text = allText(report);
    expect(text).not.toContain('javascript:');
    expect(text).toContain('• Bad');
    expect(text).toContain('• Worse');
  });

  it('keeps every block within Slack limits', () => {
    const long = 'x'.repeat(5_000);
    const report = buildMemberReport({
      member: { ...member, name: long, title: long },
      analysis: { ...analysis, summary: long, insights: [long, long], recommendations: [long] },
    });

    const blocks = blocksOf(report);
    expect(blocks[0].text.text.length).toBeLessThanOrEqual(150);
    for (const block of blocks) {
      if (block.text) expect(block.text.text.length).toBeLessThanOrEqual(3_000);
      for (const field of block.fields ?? []) expect(field.text.length).toBeLessThanOrEqual(2_000);
    }
  });

  it('describes non-channel triggers', () => {
    const report = buildMemberReport({ member, analysis: { ...analysis, trigger: 'team_join', triggerChannelId: null } });
    expect(blocksOf(report)[1].fields[5].text).toBe('*Trigger*\nJoined the workspace');
  });
});

describe('helpers', () => {
  it('escapes mrkdwn control characters', () => {
    expect(escapeMrkdwn('a & <b> c')).toBe('a &amp; &lt;b&gt; c');
  });

  it('truncates with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
