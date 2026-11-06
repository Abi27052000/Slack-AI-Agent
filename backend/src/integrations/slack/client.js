import { toMemberProfile } from './profile.js';

/**
 * Fetches a user's full profile via `users.info`.
 * Needs the `users:read` scope (plus `users:read.email` for the email field).
 */
export async function fetchUserProfile(client, userId) {
  const res = await client.users.info({ user: userId });

  if (!res.ok || !res.user) {
    throw new Error(`users.info failed for ${userId}: ${res.error ?? 'no user returned'}`);
  }

  return toMemberProfile(res.user);
}
