import { describe, it, expect } from 'vitest';
import { researchGitHub } from '../../src/integrations/research/github.js';
import { fakeFetch, json } from './helpers.js';

const searchUrl = (q, perPage) =>
  `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=${perPage}`;
const EMAIL_Q = searchUrl('jane@acme.io in:email type:user', 2);
const NAME_Q = searchUrl('fullname:"Jane Doe" type:user', 10);
const userUrl = (login) => `https://api.github.com/users/${login}`;

const hits = (...logins) => () => json({ total_count: logins.length, items: logins.map((login) => ({ login })) });
const user = (login = 'janedoe') => () =>
  json({
    login,
    name: 'Jane Doe',
    html_url: `https://github.com/${login}`,
    company: '@acme',
    blog: '',
    bio: 'Platform engineer',
    location: 'Berlin',
    public_repos: 42,
    followers: 310,
    created_at: '2015-03-01T00:00:00Z',
  });

const research = (routes, member = { email: 'jane@acme.io', name: 'Jane Doe' }, opts = {}) => {
  const fetchFn = fakeFetch(routes);
  return { fetchFn, promise: researchGitHub(member, { fetchFn, ...opts }) };
};

describe('researchGitHub', () => {
  it('matches a user by public email with high confidence', async () => {
    const { fetchFn, promise } = research({ [EMAIL_Q]: hits('janedoe'), [userUrl('janedoe')]: user() });

    expect(await promise).toMatchObject({
      provider: 'github',
      url: 'https://github.com/janedoe',
      title: 'GitHub: janedoe',
      summary: '42 public repos · 310 followers · works at @acme · Berlin',
      confidence: 'high',
      matchedBy: 'email',
      data: { login: 'janedoe', publicRepos: 42, blog: null },
    });
    expect(fetchFn).toHaveBeenCalledTimes(2); // no name search needed
  });

  it('picks the login matching the name among look-alike accounts (medium)', async () => {
    const { promise } = research({
      [EMAIL_Q]: hits(),
      [NAME_Q]: hits('JaneD', 'jane-doe', 'janedoe1990'),
      [userUrl('jane-doe')]: user('jane-doe'),
    });
    expect(await promise).toMatchObject({ confidence: 'medium', matchedBy: 'name', url: 'https://github.com/jane-doe' });
  });

  it('accepts a login equal to the email local part (medium)', async () => {
    const { promise } = research(
      {
        [searchUrl('jdoe42@acme.io in:email type:user', 2)]: hits(),
        [NAME_Q]: hits('jdoe42', 'someone-else'),
        [userUrl('jdoe42')]: user('jdoe42'),
      },
      { email: 'jdoe42@acme.io', name: 'Jane Doe' },
    );
    expect(await promise).toMatchObject({ confidence: 'medium', data: { login: 'jdoe42' } });
  });

  it('accepts a single unambiguous name hit with low confidence', async () => {
    const { promise } = research({ [EMAIL_Q]: hits(), [NAME_Q]: hits('jd-codes'), [userUrl('jd-codes')]: user('jd-codes') });
    expect(await promise).toMatchObject({ confidence: 'low', matchedBy: 'name' });
  });

  it('refuses to guess when several unrelated accounts share the name', async () => {
    const { promise } = research({ [EMAIL_Q]: hits(), [NAME_Q]: hits('jd-codes', 'jane-d-2') });
    expect(await promise).toBeNull();
  });

  it('does not search single-word names', async () => {
    const { fetchFn, promise } = research({}, { name: 'jane' });
    expect(await promise).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('strips search syntax from names', async () => {
    const q = searchUrl('fullname:"Jane Doe type user" type:user', 10);
    const { fetchFn, promise } = research({ [q]: hits() }, { name: 'Jane "Doe" type:user' });
    await promise;
    expect(fetchFn).toHaveBeenCalledWith(q, expect.anything());
  });

  it('sends the token when configured', async () => {
    const { fetchFn, promise } = research({ [NAME_Q]: hits() }, { name: 'Jane Doe' }, { token: 'ghp_test' });
    await promise;
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer ghp_test');
  });

  it('raises a clear error when rate limited', async () => {
    const { promise } = research(
      {
        [NAME_Q]: () =>
          json(
            { message: 'API rate limit exceeded' },
            { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' } },
          ),
      },
      { name: 'Jane Doe' },
    );
    await expect(promise).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('Set GITHUB_TOKEN'),
    });
  });

  it('raises on other API errors', async () => {
    const { promise } = research({ [NAME_Q]: () => json({}, { status: 500 }) }, { name: 'Jane Doe' });
    await expect(promise).rejects.toMatchObject({ code: 'API_ERROR' });
  });
});
