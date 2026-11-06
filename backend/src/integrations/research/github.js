const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

function createClient({ token, signal, fetchFn = fetch }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'AI-Slack-Agent',
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  return async function get(path) {
    const res = await fetchFn(`${API}${path}`, { headers, signal });

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (res.status === 429 || remaining === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const when = reset ? ` (resets ${new Date(reset * 1000).toISOString()})` : '';
        throw new GitHubError(
          `GitHub rate limit exceeded${when}. Set GITHUB_TOKEN for a higher limit.`,
          'RATE_LIMITED',
          res.status,
        );
      }
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(`GitHub API ${path} failed with ${res.status}`, 'API_ERROR', res.status);
    return res.json();
  };
}

/** GitHub search treats quotes and qualifiers specially; keep names to safe characters. */
const sanitize = (value) => value.replace(/["\\:]/g, ' ').replace(/\s+/g, ' ').trim();

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Picks a login from full-name search hits. Name searches nearly always return look-alike accounts
 * (e.g. "SindSorhus", "sindreshus1"), so "exactly one hit" is too strict and "first hit" is wrong.
 *  - a login equal to the name ("Jane Doe" -> janedoe / jane-doe) or the email's local part: "medium"
 *  - otherwise, a single unambiguous hit: "low"
 */
function pickNameMatch(items, totalCount, { fullName, email }) {
  const expected = new Set([normalize(fullName)]);
  const localPart = email?.split('@')[0];
  if (localPart && normalize(localPart).length >= 4) expected.add(normalize(localPart));

  const exact = items.filter((item) => expected.has(normalize(item.login)));
  if (exact.length === 1) return { login: exact[0].login, confidence: 'medium', matchedBy: 'name' };
  if (totalCount === 1) return { login: items[0].login, confidence: 'low', matchedBy: 'name' };
  return null;
}

/**
 * Finds a member's GitHub profile.
 *  1. Search users by email (only matches people who made their email public): confidence "high".
 *  2. Otherwise search by full name and match conservatively (see pickNameMatch).
 * Unlike the reference project, a common name with many hits is NOT matched to the first result.
 *
 * @returns {Promise<null | { provider: 'github', type: 'github_profile', url: string, title: string,
 *   summary: string, confidence: 'high'|'medium'|'low', matchedBy: 'email'|'name', data: object }>}
 */
export async function researchGitHub({ email, name }, { token, signal, fetchFn } = {}) {
  const get = createClient({ token, signal, fetchFn });
  let match = null;

  if (email) {
    // type:user, otherwise organisations that list the same email are counted too.
    const result = await get(`/search/users?q=${encodeURIComponent(`${email} in:email type:user`)}&per_page=2`);
    if (result?.total_count === 1) match = { login: result.items[0].login, confidence: 'high', matchedBy: 'email' };
  }

  const fullName = name ? sanitize(name) : '';
  // Single-word names ("jane") are far too ambiguous to search on.
  if (!match && fullName.includes(' ')) {
    const result = await get(`/search/users?q=${encodeURIComponent(`fullname:"${fullName}" type:user`)}&per_page=10`);
    if (result?.items?.length) match = pickNameMatch(result.items, result.total_count, { fullName, email });
  }

  if (!match) return null;

  const user = await get(`/users/${encodeURIComponent(match.login)}`);
  if (!user) return null;

  const summary = [
    `${user.public_repos} public repos`,
    `${user.followers} followers`,
    user.company && `works at ${user.company}`,
    user.location,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    provider: 'github',
    type: 'github_profile',
    url: user.html_url,
    title: `GitHub: ${user.login}`,
    summary,
    confidence: match.confidence,
    matchedBy: match.matchedBy,
    data: {
      login: user.login,
      name: user.name,
      company: user.company,
      blog: user.blog || null,
      bio: user.bio,
      location: user.location,
      publicRepos: user.public_repos,
      followers: user.followers,
      createdAt: user.created_at,
    },
  };
}
