/** Slack's own built-in bot user. */
const SLACKBOT_USER_ID = 'USLACKBOT';

/**
 * Maps a Slack user object (from `users.info` or a `team_join` payload) to the fields we store.
 * `deleted` is only used for filtering and is not persisted.
 */
export function toMemberProfile(user) {
  const profile = user.profile ?? {};

  return {
    slackUserId: user.id,
    slackTeamId: user.team_id ?? null,
    name:
      user.real_name ||
      profile.real_name ||
      profile.display_name ||
      user.name ||
      user.id,
    username: user.name ?? null,
    email: profile.email ?? null,
    title: profile.title || null,
    timezone: user.tz ?? null,
    avatarUrl: profile.image_192 ?? profile.image_72 ?? null,
    isBot: Boolean(user.is_bot || user.is_app_user || user.id === SLACKBOT_USER_ID),
    deleted: Boolean(user.deleted),
    // A small, non-sensitive subset of the raw profile (no phone numbers etc.).
    profile: {
      firstName: profile.first_name ?? null,
      lastName: profile.last_name ?? null,
      displayName: profile.display_name ?? null,
      statusText: profile.status_text ?? null,
      isAdmin: Boolean(user.is_admin),
      isGuest: Boolean(user.is_restricted || user.is_ultra_restricted),
    },
  };
}
