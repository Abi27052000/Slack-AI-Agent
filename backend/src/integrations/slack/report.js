import config from '../../config/index.js';
import { buildMemberReport } from './blocks.js';
import { getSlackClient } from './connection.js';

export class ReportNotPostedError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReportNotPostedError';
    this.code = code;
  }
}

/** Whether a report could be posted right now (Slack connected and a channel configured). */
export function canPostReports() {
  return Boolean(getSlackClient() && config.slack.reportChannelId);
}

/**
 * Posts the analysis report to the private report channel.
 * @returns {Promise<{ channel: string, ts: string }>}
 */
export async function postMemberReport({ member, analysis }) {
  const client = getSlackClient();
  if (!client) throw new ReportNotPostedError('Slack is not connected', 'SLACK_DISABLED');
  if (!config.slack.reportChannelId) {
    throw new ReportNotPostedError('SLACK_REPORT_CHANNEL_ID is not set', 'NO_REPORT_CHANNEL');
  }

  const message = buildMemberReport({ member, analysis, dashboardUrl: config.pipeline.dashboardUrl });
  const res = await client.chat.postMessage({
    channel: config.slack.reportChannelId,
    ...message,
    unfurl_links: false,
    unfurl_media: false,
  });

  return { channel: res.channel, ts: res.ts };
}
