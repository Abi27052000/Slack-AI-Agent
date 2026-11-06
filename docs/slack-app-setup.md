# Slack app setup

The backend runs without Slack: if the tokens are empty, it logs `Slack integration disabled` and you can
simulate events locally (see [Testing without Slack](#testing-without-slack)). When you want the real
thing, follow these steps. Everything here is free.

## 1. Create a Slack workspace (if you don't have one)

1. Go to <https://slack.com/get-started#/createnew> and sign up with your email.
2. Create a new workspace (e.g. "AI Agent Sandbox"). The free plan is enough.
3. Create two channels:
   - `#welcome`: a channel the agent watches for new joiners (optional)
   - `#member-reports`: a **private** channel for the agent's reports

## 2. Create the Slack app from the manifest

1. Open <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick your workspace, choose **YAML**, and paste the contents of [`slack-app-manifest.yml`](../slack-app-manifest.yml).
3. Review → **Create**.

This sets up Socket Mode, the bot scopes (`users:read`, `users:read.email`, `channels:read`, `chat:write`)
and the `team_join` / `member_joined_channel` events in one go.

## 3. Get the three secrets

| Variable               | Where to find it                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SLACK_APP_TOKEN`      | **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**, add `connections:write` → `xapp-…` |
| `SLACK_BOT_TOKEN`      | **Install App** → **Install to Workspace** → allow → **Bot User OAuth Token** `xoxb-…`                           |
| `SLACK_SIGNING_SECRET` | **Basic Information** → **App Credentials** → **Signing Secret**                                                 |

Put them in `backend/.env`. Never commit them (`.env` is git-ignored).

## 4. Channel IDs

Open a channel → click its name → the **Channel ID** (`C…`) is at the bottom of the About tab.

- `SLACK_WATCH_CHANNEL_IDS=C0123WELCOME`: joins to these channels trigger the agent (comma-separated).
  Leave empty to react to new workspace members (`team_join`) only.
- `SLACK_REPORT_CHANNEL_ID=C0456REPORTS`: where reports are posted. Leave empty to store analyses without posting.

**Invite the bot** to every channel above: in the channel, type `/invite @AI Slack Agent`.
Slack only sends `member_joined_channel` for channels the bot is in.

## 5. Run it

```bash
cd backend
npm run dev
```

You should see:

```
INFO: Authenticated as @ai_slack_agent in workspace "AI Agent Sandbox"
INFO: Socket Mode connected
```

`GET http://localhost:5000/api/health/ready` now reports `"slack": "up"`. Invite a second account (or a
colleague) to the workspace, or have them join a watched channel, and you'll see `Member joined: …` in the logs
and a row in the `members` table (`npm run db:studio`).

## Testing without Slack

With the tokens empty, the dev-only endpoint feeds events through the same handlers:

```bash
curl -X POST http://localhost:5000/api/dev/slack/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "team_join",
    "user": {
      "id": "U012ABC",
      "real_name": "Jane Doe",
      "tz": "Europe/Berlin",
      "profile": { "email": "jane@acme.io", "title": "Head of Platform" }
    }
  }'
```

`member_joined_channel` needs a live Slack connection (it looks the user up via `users.info`), so without
Slack, only unwatched-channel skips can be simulated.

The response contains `analysis.analysisId`. Once the analysis finishes (about 10s), preview the Slack
report it would post:

```bash
curl http://localhost:5000/api/dev/analyses/<analysisId>
```

Open the returned `blockKitBuilderUrl` in a browser to see the report rendered by Slack's Block Kit Builder
(sign-in to any Slack workspace may be required).

## Troubleshooting

| Log message                                                   | Fix                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Slack authentication failed (invalid_auth)`                  | Wrong or revoked `SLACK_BOT_TOKEN`; reinstall the app and copy the token again    |
| `SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set together`    | Set both tokens, or neither                                                       |
| No `Member joined` log when someone joins a channel           | Channel ID missing from `SLACK_WATCH_CHANNEL_IDS`, or the bot isn't in the channel |
| `email` is null on members                                    | The `users:read.email` scope was added after install; reinstall the app           |
