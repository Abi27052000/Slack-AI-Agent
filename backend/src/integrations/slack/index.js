import { format } from 'node:util';
import bolt from '@slack/bolt';
import config from '../../config/index.js';
import logger from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { upsertMemberFromSlack } from '../../services/member.service.js';
import { fetchUserProfile } from './client.js';
import { createEventHandlers } from './events.js';

const { App, SocketModeReceiver, LogLevel } = bolt;

const log = logger.child({ module: 'slack' });

let app = null;
let botUserId = null;
/** 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' */
let connectionState = 'disabled';

/** Adapts our pino logger to Bolt's Logger interface. */
function createBoltLogger() {
  let level = LogLevel.INFO;
  const write = (method) => (...args) => log[method](format(...args));
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    setLevel: (next) => {
      level = next;
    },
    getLevel: () => level,
    setName: () => {},
  };
}

/** Event handlers shared by the live Bolt app and the dev simulation endpoint. */
export const slackEventHandlers = createEventHandlers({
  upsertMember: upsertMemberFromSlack,
  fetchUserProfile: async (userId) => {
    if (!app) {
      throw new AppError(
        503,
        'Slack is not configured, so users.info is unavailable. Simulate a team_join event with a full user object instead.',
        'SLACK_DISABLED',
      );
    }
    return fetchUserProfile(app.client, userId);
  },
  watchChannelIds: config.slack.watchChannelIds,
  getBotUserId: () => botUserId,
  logger: log,
});

/** Wraps a handler so one bad event never crashes the process. */
const safely = (name, handler) => async ({ event }) => {
  try {
    await handler(event);
  } catch (err) {
    log.error({ err, event: { type: event.type, user: event.user?.id ?? event.user } }, `Failed to handle ${name}`);
  }
};

/**
 * Connects to Slack over Socket Mode. Resolves to false (and logs a warning) when Slack
 * tokens aren't configured, so the API still runs locally without a Slack workspace.
 */
export async function startSlack() {
  if (!config.slack.enabled) {
    log.warn(
      'Slack integration disabled (SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set). ' +
        'Simulate events with POST /api/dev/slack/events.',
    );
    return false;
  }

  const boltLogger = createBoltLogger();
  const receiver = new SocketModeReceiver({ appToken: config.slack.appToken, logger: boltLogger });

  for (const state of ['connecting', 'connected', 'reconnecting', 'disconnected']) {
    receiver.client.on(state, () => {
      connectionState = state;
      if (state === 'connected') log.info('Socket Mode connected');
      if (state === 'reconnecting' || state === 'disconnected') log.warn(`Socket Mode ${state}`);
    });
  }

  // deferInitialization: Bolt otherwise verifies the token in a floating promise inside the
  // constructor (an unhandled rejection on bad tokens); app.init() below awaits it instead.
  app = new App({
    token: config.slack.botToken,
    receiver,
    logger: boltLogger,
    deferInitialization: true,
  });

  app.event('team_join', safely('team_join', slackEventHandlers.onTeamJoin));
  app.event('member_joined_channel', safely('member_joined_channel', slackEventHandlers.onMemberJoinedChannel));
  app.error(async (err) => log.error({ err }, 'Slack app error'));

  // Verifies the bot token up front (clear "invalid_auth" error) and tells us our own user id.
  let auth;
  try {
    await app.init();
    auth = await app.client.auth.test();
  } catch (err) {
    app = null;
    const cause = err.original ?? err;
    const code = cause.data?.error ?? cause.code ?? cause.message;
    throw new Error(`Slack authentication failed (${code}). Check SLACK_BOT_TOKEN.`, { cause: err });
  }
  botUserId = auth.user_id;
  log.info(`Authenticated as @${auth.user} in workspace "${auth.team}"`);

  if (config.slack.watchChannelIds.length === 0) {
    log.info('SLACK_WATCH_CHANNEL_IDS is empty: reacting to team_join events only');
  }

  await app.start();
  return true;
}

export async function stopSlack() {
  if (!app) return;
  await app.stop();
  app = null;
  connectionState = 'disconnected';
}

/** Readiness probe for the Socket Mode connection. */
export function isSlackConnected() {
  return connectionState === 'connected';
}
