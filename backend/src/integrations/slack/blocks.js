/**
 * Builds the Block Kit report posted for each analysed member.
 *
 * Everything shown comes from member profiles, websites or the LLM, so all text is escaped
 * (Slack mrkdwn treats &, <, > specially: `<!channel>` would ping everyone) and truncated to
 * Slack's per-block limits.
 */

const TIER_STYLE = {
  HOT: { color: '#2EB67D', emoji: '🔥', label: 'Hot' },
  WARM: { color: '#ECB22E', emoji: '☀️', label: 'Warm' },
  COOL: { color: '#F2952F', emoji: '🌤️', label: 'Cool' },
  COLD: { color: '#E01E5A', emoji: '❄️', label: 'Cold' },
};
const FALLBACK_STYLE = { color: '#9E9EA6', emoji: '⚠️', label: 'Needs review' };

const TRIGGER_LABEL = {
  team_join: 'Joined the workspace',
  member_joined_channel: 'Joined a watched channel',
  manual: 'Manual re-analysis',
  dev: 'Dev simulation',
};

/** Escapes Slack mrkdwn control characters. */
export function escapeMrkdwn(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const safe = (text, max = 2_900) => escapeMrkdwn(truncate(text, max));
const bullets = (items, max = 2_900) => truncate(items.map((item) => `• ${escapeMrkdwn(item)}`).join('\n'), max);

/** Only http(s) links are rendered; anything else could be a `javascript:`-style surprise. */
function safeLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return safe(label, 200);
    // `|` and `>` would break Slack's <url|label> syntax.
    return `<${parsed.toString().replace(/[|>]/g, encodeURIComponent)}|${safe(label, 200).replace(/\|/g, '¦')}>`;
  } catch {
    return safe(label, 200);
  }
}

function triggerText(analysis) {
  if (analysis.trigger === 'member_joined_channel' && analysis.triggerChannelId) {
    return `Joined <#${analysis.triggerChannelId}>`;
  }
  return TRIGGER_LABEL[analysis.trigger] ?? analysis.trigger ?? 'Unknown';
}

/**
 * @param {object} params
 * @param {object} params.member    Member row
 * @param {object} params.analysis  MemberAnalysis row (fitScore, tier, summary, insights, ...)
 * @param {string} [params.dashboardUrl]
 * @returns {{ text: string, attachments: object[] }} chat.postMessage arguments (minus channel)
 */
export function buildMemberReport({ member, analysis, dashboardUrl }) {
  const style = analysis.isFallback || !analysis.tier ? FALLBACK_STYLE : TIER_STYLE[analysis.tier];
  const scoreText = analysis.fitScore === null || analysis.fitScore === undefined ? 'n/a' : `${analysis.fitScore}/100`;
  const insights = Array.isArray(analysis.insights) ? analysis.insights : [];
  const recommendations = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
  const sources = Array.isArray(analysis.researchData?.sources) ? analysis.researchData.sources : [];

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: truncate(`🔍 New member: ${member.name}`, 150), emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Fit score*\n${style.emoji} *${scoreText}* · ${style.label}` },
        { type: 'mrkdwn', text: `*Confidence*\n${safe(analysis.confidence ?? 'n/a', 50)}` },
        { type: 'mrkdwn', text: `*Title*\n${safe(member.title ?? 'Not provided', 200)}` },
        { type: 'mrkdwn', text: `*Email*\n${safe(member.email ?? 'Not provided', 200)}` },
        { type: 'mrkdwn', text: `*Profile*\n<@${member.slackUserId}>` },
        { type: 'mrkdwn', text: `*Trigger*\n${triggerText(analysis)}` },
      ],
    },
  ];

  if (analysis.isFallback) {
    const code = analysis.error ? ` (${safe(analysis.error.split(':')[0], 60)})` : '';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `⚠️ *Automatic analysis unavailable${code}.* Manual review needed.` },
    });
  } else if (analysis.summary) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: safe(analysis.summary) } });
  }

  if (insights.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Insights*\n${bullets(insights)}` } });
  }
  if (recommendations.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommendations*\n${bullets(recommendations)}` },
    });
  }
  if (sources.length > 0) {
    const lines = sources
      .slice(0, 6)
      .map((s) => `• ${safeLink(s.url, s.title ?? s.provider)}${s.confidence ? ` _(${safe(s.confidence, 20)} confidence)_` : ''}`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(`*Research sources*\n${lines.join('\n')}`, 2_900) } });
  }

  const context = [
    analysis.model && safe(analysis.model, 60),
    analysis.promptVersion && safe(analysis.promptVersion, 40),
    analysis.durationMs && `analysed in ${(analysis.durationMs / 1000).toFixed(1)}s`,
    dashboardUrl && `<${dashboardUrl}/analyses/${analysis.id}|View in dashboard>`,
  ].filter(Boolean);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `📊 ${context.join(' · ') || 'Member analysis'}` }] });

  return {
    // Plain-text fallback for notifications and clients that can't render blocks.
    text: `New member analysis: ${truncate(member.name, 100)} (${scoreText})`,
    // An attachment gives the coloured bar down the side; the content itself is modern blocks.
    attachments: [{ color: style.color, blocks }],
  };
}
