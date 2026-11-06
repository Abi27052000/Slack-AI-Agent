# Admin API

REST API used by the admin dashboard. Base URL: `http://localhost:5000/api`.

## Authentication

Every endpoint below (except health) requires the admin API key:

```
Authorization: Bearer <ADMIN_API_KEY>
```

`X-API-Key: <ADMIN_API_KEY>` works too. A missing or wrong key returns `401`. In development, if
`ADMIN_API_KEY` is empty, the API is open (the server logs a warning); in production the key is required.

## Errors

All errors share one shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request",
    "details": [{ "location": "query", "path": "minScore", "message": "minScore must be less than or equal to maxScore" }],
    "requestId": "0e4507d1-…"
  }
}
```

## Endpoints

### `GET /analyses`

Paginated list of analyses, each with its member. Heavy fields (`researchData`, `usage`) are omitted.

| Query        | Example              | Notes                                                                   |
| ------------ | -------------------- | ----------------------------------------------------------------------- |
| `page`       | `2`                  | default `1`                                                             |
| `pageSize`   | `50`                 | default `20`, max `100`                                                 |
| `status`     | `POSTED,ANALYZED`    | `PENDING RESEARCHING ANALYZING ANALYZED POSTED FAILED`, comma-separated |
| `tier`       | `HOT,WARM`           | `HOT WARM COOL COLD`, case-insensitive                                  |
| `minScore`   | `60`                 | 0–100                                                                   |
| `maxScore`   | `100`                | 0–100, must be ≥ `minScore`                                             |
| `search`     | `jane`               | case-insensitive match on member name, email or title                   |
| `isFallback` | `true`               | only analyses that need manual review (or `false` to exclude them)      |
| `memberId`   | `cmw4…`              | one member's analyses                                                   |
| `sort`       | `fitScore`           | `createdAt` (default) or `fitScore` (unscored last)                     |
| `order`      | `asc`                | default `desc`                                                          |

```json
{
  "data": [
    {
      "id": "cmw4…",
      "status": "POSTED",
      "trigger": "team_join",
      "fitScore": 68,
      "tier": "WARM",
      "confidence": "medium",
      "summary": "…",
      "isFallback": false,
      "error": null,
      "model": "gemini-3.6-flash",
      "promptVersion": "member-fit-v1",
      "attempts": 1,
      "durationMs": 8923,
      "postedAt": "2026-11-06T10:48:32.000Z",
      "completedAt": "2026-11-06T10:48:31.000Z",
      "createdAt": "2026-11-06T10:48:23.000Z",
      "updatedAt": "2026-11-06T10:48:32.000Z",
      "member": { "id": "…", "name": "Jane Doe", "email": "jane@python.org", "title": "Head of Platform", "avatarUrl": null, "slackUserId": "U012ABC" }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 }
}
```

### `GET /analyses/:id`

The full analysis: all list fields plus `insights`, `recommendations`, `researchData`
(`{ sources, skipped, errors, durationMs }`), `usage` (token counts), Slack message info, the full `member`,
and `history`: the member's analyses, newest first (`id, status, trigger, fitScore, tier, isFallback, createdAt`).
`404` if not found.

### `POST /analyses/:id/reanalyze`

Queues a fresh analysis of the same member, ignoring the re-analysis cooldown.

- `202` `{ "status": "queued", "analysisId": "<new id>" }`
- `409` `{ "status": "skipped", "reason": "analysis_in_progress", "analysisId": "<running id>" }`: one is already running for this member
- `404` if the analysis doesn't exist

The new analysis appears in `GET /analyses` immediately with status `PENDING`, and finishes in roughly 10–20s.

### `GET /stats?days=7`

`days`: 1–90, default 7.

```json
{
  "totals": {
    "members": 3,
    "analyses": 4,
    "scored": 3,
    "fallback": 0,
    "byStatus": { "PENDING": 0, "RESEARCHING": 0, "ANALYZING": 1, "ANALYZED": 3, "POSTED": 0, "FAILED": 0 }
  },
  "averageScore": 48,
  "tiers": { "HOT": 0, "WARM": 2, "COOL": 0, "COLD": 1 },
  "range": { "days": 3, "since": "2026-11-04T00:00:00.000Z" },
  "daily": [
    { "date": "2026-11-04", "count": 0, "averageScore": null },
    { "date": "2026-11-05", "count": 0, "averageScore": null },
    { "date": "2026-11-06", "count": 4, "averageScore": 48 }
  ],
  "tokens": { "total": 5601 },
  "queue": { "queued": 0, "running": 1 }
}
```

`totals`, `averageScore` and `tiers` are all-time; `daily` and `tokens` cover the requested range (UTC days).

### Public

- `GET /health`: liveness
- `GET /health/ready`: readiness (database, Slack)

Development-only helpers live under `/dev` (see [slack-app-setup.md](slack-app-setup.md#testing-without-slack)).
