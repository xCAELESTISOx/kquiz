# @kquiz/api

Hono + SQLite (better-sqlite3, Drizzle). One owner, passkey login, FSRS scheduling in three modes: meaning, speech (say it aloud) and listening (hear it, no text).

```sh
pnpm dev            # http://127.0.0.1:8787, prints a one-time setup code on first start
pnpm test
pnpm db:generate    # after editing src/db/schema.ts; migrations in drizzle/ apply on start
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_PATH` | `./data/kquiz.db` | SQLite file |
| `ORIGIN` | `http://localhost:5173` | Public origin of the app; passkeys are bound to its host, and it is the MCP/OAuth issuer. https in production |
| `MCP_REDIRECT_URIS` | Claude's callbacks | Comma-separated OAuth redirect URIs a client may register |
| `ORIGIN_SECRET` | — | Required in production. Cloudflare adds it as header `x-kquiz-origin` (Transform Rule); requests without it get 403 |
| `SETUP_CODE` | random, printed to the log | Code for binding the first passkey; useless once one is bound |
| `TIME_ZONE` | `Asia/Seoul` | Where "today" starts: reviewed today and the daily new-card allowance |
| `SCORER_URL` | `http://127.0.0.1:8788` | services/scorer; it listens on localhost only |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Only Caddy on the same host talks to the API |

## Protection

- Cloudflare only: every request except `/api/health`, including `/mcp`, `/oauth/*` and `/.well-known/*`, needs `x-kquiz-origin` and `cf-connecting-ip`. The firewall admitting only Cloudflare's IPs is the first line; this header stops anyone who finds the server's IP.
- Limits per client IP: passkey endpoints 5/min (plus 30/min overall), the rest of `/api` 300/min. The limiter tracks at most 10 000 clients and refuses new ones beyond that, so an IP flood can't eat memory. Shared limits for score and MCP are in `limits` in `src/security/rateLimit.ts`.
- Body limit 1 MB, challenges live 5 min and are capped at 20 rows, at most 20 sessions.
- Session: `__Host-kq_session` cookie, httpOnly, Secure, SameSite=Strict, 30 days; stored as SHA-256. Every non-GET request needs header `x-csrf-token`; cross-site form posts are refused.

## Endpoints

All JSON. Everything except health and `/auth/status|login|register` needs the session.

**Auth** (`/api/auth`)
- `GET /status` → `{ authenticated, setupRequired, csrfToken? }`
- `POST /register/options` `{ setupCode? }` → WebAuthn creation options. First passkey: `setupCode`; later ones: open session + CSRF.
- `POST /register/verify` `{ response, setupCode?, name? }` → `{ ok, csrfToken? }` (first passkey also signs in)
- `POST /login/options` → WebAuthn request options; `POST /login/verify` `{ response }` → `{ ok, csrfToken }`
- `POST /logout`, `GET /passkeys`, `DELETE /passkeys/:id` (the last passkey can't be removed)

**Cards** (`/api/cards`)
- `GET /?q=&tag=&notReady=1&status=queued|paused&limit=50&before=<id>` → `{ cards, nextBefore }`, newest first
- `GET /summary` → `{ counts: { all, queued, paused }, tags: [{ tag, count }] }`
- `POST /` card → `201 { card }`, `409 { error: "duplicate", existingId }`
- `POST /bulk` `{ text }` (lines `한국어 — перевод`) or `{ cards: [...] }`, ≤ 50 → `{ created, duplicates, rejected }`
- `POST /bulk/preview` `{ text }` → parsed lines without saving
- `GET /:id`, `PATCH /:id` (partial; `""` clears an optional field; `suspended` pauses), `DELETE /:id`
- `POST /:id/introduce` → `{ card }`: takes a queued card into reviews now, outside the daily allowance; `409 not_queued`

Card: `{ id, korean, meaning, pronunciation, romanization, examples, notes, tags, speakable, readyForSpeech, source, suspended, queued, createdAt, updatedAt }`, where `examples` is up to 3 `{ ko, ru }` sentences (Claude must always send exactly 3 through MCP). Duplicates are detected ignoring spaces and punctuation. `readyForSpeech` is false when `korean` has non-Hangul text; such cards never become `speakable`.

**New-card queue** (`src/newCards.ts`). Cards Claude adds through MCP don't enter reviews at once: they are `queued` and come in `newPerDay` a day (default 15), picked at random, the first time the queue or stats are read that day (`TIME_ZONE` midnight). Cards added in the app, one or in bulk, skip the queue. A paused (`suspended`) card is in no review queue and isn't picked from the new-card queue.

**Settings** (`/api/settings`): `GET` → `{ newPerDay }`, `PATCH { newPerDay: 0–200 }`.

**Export** (`/api/export`): `GET` → a JSON download (`kquiz-YYYY-MM-DD.json`): `{ app, version, exportedAt, settings, cards (with reviewStates), reviewLog, attempts }`.

**Reviews** (`/api/reviews`)
- `GET /queue?mode=meaning|speech|listening&limit=50` → `{ items: [{ card, mode, due, state, reps, lapses }] }`, most overdue first with never-reviewed cards spread among them at random; speech only for speakable cards, listening only for cards whose recording is made from their current Korean (the phone's voice is no model for the ear), paused cards never
- `POST /` `{ reviews: [{ id: uuid, cardId, mode, rating: again|hard|good|easy, reviewedAt, elapsedMs? }] }` (≤ 200) → `{ results: [{ id, status: applied|duplicate|card_not_found, due? }] }`. A resent `id` is a no-op; a batch is applied in `reviewedAt` order.
- `GET /stats` → `{ cards, due: { meaning, speech, listening }, reviewedToday, newCards: { introduced, limit, queued } }` (day in `TIME_ZONE`)
- `GET /leeches` → `{ items: [{ card, forgotten: { meaning?, speech?, listening? }, lastForgottenAt }] }`: hard cards, forgotten on 6+ different days (UTC) in a mode since the card's last edit. Editing a card takes it off the list. Claude reads the same list with the MCP tool `get_leeches` and reworks the cards with `update_card`.
- `GET /fsrs` → `{ modes: [{ mode, desiredRetention, personal, reviews, minReviews, trainedOnReviews, optimizedAt }], retentionRange: { min, max } }`
- `PUT /fsrs` `{ mode, desiredRetention }` (0.85–0.95) → same as `GET /fsrs`

FSRS weights are fitted per mode to the owner's own `review_log` (`src/fsrsOptimizer.ts`, fsrs-rs via `@open-spaced-repetition/binding`): first once a mode has 1000 reviews, then at most monthly when there are new ones. A fit is kept only if it predicts that history better than the current weights; then stability and difficulty are replayed with it, due dates stay. Days between reviews are counted in `TIME_ZONE` (default `Asia/Seoul`), starting at 4 am.

**Statistics** (`/api/stats`)
- `GET /?tz=540` (minutes east of UTC; days start at the owner's midnight) → `{ today, streak: { current, best, reviewedToday }, activity: [{ day, reviews }] (17 weeks), forecast: [{ day, due: { <mode>: n } }] (30 days, today includes overdue, new cards left out), retention: { <mode>: { reviews, recalled } } (30 days, without first sightings and reviews < 12 h apart), targetRetention: { <mode>: 0.9 }, cards: { total, byMode: { <mode>: { new, learning, young, mature } } }, speech: { weeks: [{ start, attempts, avgScore }] (8), sounds: [{ phone, attempts, errors, recent, previous }] } }`. Modes are whatever `review_states` holds, so a new mode appears without an API change. `sounds` are the worst by overall error rate (≥ 3 attempts); `recent` is the last 14 days, `previous` the 14 before.

**Pronunciation** (`/api/score`)
- `POST /?cardId=` with the recording as the body (`content-type: audio/wav`, ≤ 1 MB, ≤ 10 s; the web app sends 16 kHz mono 16-bit PCM) → `{ attemptId, cardId, score, pronunciation, syllables: [{ text, pron, status: ok|weak|wrong }], errors: [{ syllable, position, kind, status, expected, heard }], suggestedRating }`. Fields are the scorer's (services/scorer/README.md).
- Scoring is not a review: the app shows the result, the owner picks the rating and it goes to `POST /api/reviews` with `mode: "speech"` like any other. `suggestedRating` is forgiving: "weak" syllables never pull it below good, because the model flags about one syllable in six even in fluent native speech.
- Every attempt is saved to `attempts` (no audio) and counted in `phone_stats` for `get_weak_sounds`; only "wrong" sounds count as errors there.
- 20 recordings a minute per client. Errors: `404` unknown card, `422 not_ready_for_speech` (non-Hangul card), `422 bad_recording` (not WAV, silence, too long), `503 busy` (with `Retry-After`) or `503 unavailable` (scorer down or model not loaded), `504 timeout`.

## MCP server

`src/server.ts` mounts `/api` and the MCP app (`src/mcp/`) on one Hono server. The MCP app gets `SqliteCardStore`, `SqliteOAuthStore` and `ownerAuth()` from `src/storage/mcp.ts`. MCP card ids are the numeric ids as strings. The OAuth consent sends the owner to the web app's `/login?fresh=1&return_to=…`, which always asks for a passkey; consent then counts the session as fresh for 5 minutes.
