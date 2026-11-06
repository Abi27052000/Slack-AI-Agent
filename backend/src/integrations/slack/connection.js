/**
 * Shared Slack connection state. Kept separate from index.js (which wires events to the pipeline)
 * so the pipeline's report poster can reach the Slack client without a circular import.
 */

let app = null;
let botUserId = null;
/** 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' */
let connectionState = 'disabled';

export function setSlackApp(nextApp, nextBotUserId = null) {
  app = nextApp;
  botUserId = nextBotUserId;
  if (!nextApp) connectionState = 'disconnected';
}

export const getSlackApp = () => app;
export const getSlackClient = () => app?.client ?? null;
export const getBotUserId = () => botUserId;

export function setConnectionState(state) {
  connectionState = state;
}

export const isSlackConnected = () => connectionState === 'connected';
