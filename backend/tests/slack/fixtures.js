/** A realistic (trimmed) Slack user object, as returned by users.info / team_join. */
export function slackUser(overrides = {}) {
  return {
    id: 'U012ABC',
    team_id: 'T0001',
    name: 'jane',
    real_name: 'Jane Doe',
    tz: 'Europe/Berlin',
    deleted: false,
    is_bot: false,
    is_app_user: false,
    is_admin: false,
    profile: {
      first_name: 'Jane',
      last_name: 'Doe',
      real_name: 'Jane Doe',
      display_name: 'jane',
      email: 'jane@acme.io',
      title: 'Head of Platform',
      phone: '+49 123 456',
      status_text: 'Shipping',
      image_72: 'https://avatars.example/72.png',
      image_192: 'https://avatars.example/192.png',
    },
    ...overrides,
  };
}
