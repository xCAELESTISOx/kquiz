# @kquiz/api

Hono + SQLite (better-sqlite3, Drizzle). An owner and up to four invited people, each with their own data; passkey login, FSRS scheduling in three modes: meaning, speech (say it aloud) and listening (hear it, no text).

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
| `MCP_ALLOW_LOOPBACK` | `1` | `0` refuses loopback callbacks (`http://localhost:<port>/…`), which command-line clients such as Claude Code and Codex use |
| `ORIGIN_SECRET` | — | Required in production, at least 32 characters. The reverse proxy (Caddy in `deploy/`) sends it as header `x-kquiz-origin`; requests without it get 403 |
| `SETUP_CODE` | random, printed to the log | Code (16+ characters) for binding the first passkey; useless once one is bound |
| `TIME_ZONE` | `Asia/Seoul` | Where "today" starts: reviewed today and the midnight a learned word is first due |
| `SCORER_URL` | `http://127.0.0.1:8788` | services/scorer; it listens on localhost only |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Only Caddy on the same host talks to the API |
| `RP_NAME` | `KQuiz` | Name shown in the passkey prompt |
| `NODE_ENV` | `development` | `production` requires an https `ORIGIN` and `ORIGIN_SECRET` |

## Protection

- Reverse proxy only: when `ORIGIN_SECRET` is set, every request except `/api/health`, including `/mcp`, `/oauth/*` and `/.well-known/*`, needs `x-kquiz-origin` and `cf-connecting-ip`. Caddy sets both (`deploy/Caddyfile`): the secret, and the client address the rate limits key on. The API listens on 127.0.0.1, so this check is the second line behind the firewall. The header names date from an earlier setup with Cloudflare in front (`src/security/origin.ts`).
- Limits per client IP: passkey endpoints 5/min (plus 30/min overall), the rest of `/api` 300/min. The limiter tracks at most 10 000 clients and refuses new ones beyond that, so an IP flood can't eat memory. Shared limits for score and MCP are in `limits` in `src/security/rateLimit.ts`.
- Body limit 1 MB, challenges live 5 min and are capped at 20 rows, at most 20 sessions per person.
- People (`src/users.ts`): the owner (id 1) and members who joined by a one-time invite link (24 h, at most 5 people in all). Every query filters by the session's user; another person's card id answers 404. A member may add 200 cards a day and 5000 in all and score 300 recordings a day (`429 quota_exceeded`); the owner has no limits. TTS does the owner's cards first, and a word someone else already has reuses its audio. MCP calls are limited per person.
- Session: `__Host-kq_session` cookie, httpOnly, Secure, SameSite=Strict, 30 days; stored as SHA-256. Every non-GET request needs header `x-csrf-token`; cross-site form posts are refused.

## Endpoints

All JSON. Everything except health and `/auth/status|login|register` needs the session.

**Auth** (`/api/auth`)
- `GET /status` → `{ authenticated, setupRequired, csrfToken?, user?: { id, name, role: "owner" | "member" } }`
- `GET /invite?code=` → `{ status: "ok" | "invalid" | "full" }`
- `POST /register/options` `{ setupCode? } | { invite, userName }` → WebAuthn creation options. Owner's first passkey: `setupCode`; a new member: `invite` and their name; another passkey for yourself: open session + CSRF.
- `POST /register/verify` `{ response, setupCode?, invite?, userName?, name? }` → `{ ok, csrfToken? }` (setup and invite also sign in)
- `POST /login/options` → WebAuthn request options with no credential list (passkeys are discoverable); `POST /login/verify` `{ response }` → `{ ok, csrfToken }`
- `POST /logout`, `GET /passkeys`, `DELETE /passkeys/:id` (the last passkey can't be removed)

**People** (`/api/users`, owner only)
- `GET /` → `{ users: [{ id, name, role, createdAt, disabled, cards, lastSignInAt }], invites: [{ createdAt, expiresAt }], maxUsers, memberLimits }`
- `POST /invites` → `201 { url, expiresAt }` (the link is shown once), `409 too_many_users`; `DELETE /invites` cancels unused links
- `POST /:id/disable` signs them out everywhere and revokes their Claude connector, data kept; `POST /:id/enable`
- `DELETE /:id` deletes a disabled member and everything of theirs (`409 disable_first` otherwise)

**Cards** (`/api/cards`)
- `GET /?q=&tag=&root=<hanja>&notReady=1&status=queued|paused&limit=50&before=<id>` → `{ cards, nextBefore }`, newest first; `root` keeps the cards with that root (a word family)
- `GET /:id/family` → `{ families: [{ ko, hanja, meaning, cards: [{ id, korean, meaning }] (newest 5), total }] }`: for each root of the card, the other cards that share its hanja
- `GET /summary` → `{ counts: { all, queued, paused }, tags: [{ tag, count }] }`
- `POST /` card → `201 { card }`, `409 { error: "duplicate", existingId }`
- `POST /bulk` `{ text }` (lines `한국어 — translation`) or `{ cards: [...] }`, ≤ 50 → `{ created, duplicates, rejected }`
- `POST /bulk/preview` `{ text }` → parsed lines without saving
- `GET /:id`, `PATCH /:id` (partial; `""` clears an optional field; `suspended` pauses), `DELETE /:id`
- `POST /learned { cardIds, missed? }` → `{ introduced }`: new words just learned in the Learn session for a group enter reviews, due at the next `TIME_ZONE` midnight, the `missed` ones 2 hours from now (not later than that midnight); cards already in reviews are left alone
- `POST /:id/introduce` → `{ card }`: takes a new word into reviews now, unlearned; `409 not_queued`

Card: `{ id, korean, meaning, pronunciation, romanization, examples, notes, tags, roots, kind, parts, register, speakable, readyForSpeech, source, suspended, queued, createdAt, updatedAt }`, where `examples` is up to 3 `{ ko, ru }` sentences (`ru` holds the translation) (Claude must always send exactly 3 through MCP). `roots` are the Sino-Korean roots `[{ ko, hanja, meaning }]` (학 學 "study"): `null` until filled in (Claude does it; MCP `set_roots` for older cards, which is not an edit and keeps a hard card on its list), `[]` for a native word. Cards sharing a hanja are one word family; the hanja is the key, since one syllable has unrelated roots. Duplicates are detected ignoring spaces and punctuation. `readyForSpeech` is false when `korean` has non-Hangul text; such cards never become `speakable`.

**Phrases** (`src/phrases.ts`). `kind` is `word` (default) or `phrase`: a set phrase learned whole (안녕히 가세요). A phrase has no examples; `parts` breaks it into its pieces in order, `[{ ko, base?, meaning }]` (`ko` as written in the phrase, `base` its dictionary form), and `register` is `formal` (합쇼체), `polite` (해요체) or `casual` (반말). `GET /cards/:id` adds `cardId` to each part the user has a word card for. Phrases are reviewed in the `meaning` schedule by building them from blocks after the translation, and in `listening` by ear; they stay out of the `speech` queue for now. `GET /cards?kind=phrase` and the group `kind` filter narrow to phrases; `/cards/summary` counts them.

**New words** (`src/newCards.ts`). No card enters reviews when it is added, from Claude or in the app: it is `queued` in the pool until learned. The app's session learns `ACTIVE_WORDS` (5) at a time, oldest added first. Each climbs a ladder of 3 tasks; a miss takes it one step down. At the top it frees its place for the next word and waits 3 hours for a check (written from the translation): right, it enters reviews due at the next `TIME_ZONE` midnight; wrong, it goes back to the ladder's last step. `newCards` in `/reviews/stats` is `{ queued }`. A paused (`suspended`) card is in no review queue and isn't learned. Migration 0014 sent cards that had never been reviewed back to the pool.
- `GET /cards/learning` → `{ items: [{ card, step }], pool }`: the words due for their check (`step: "check"`), then the ones being learned (`step` 0–2), filled up to 5 from the pool; `pool` is how many more wait
- `POST /cards/:id/learning { ok }` → `{ status: "climbed", step } | { status: "missed", step } | { status: "passed", next } | { status: "learned", due }`; `409 not_queued`

**Settings** (`/api/settings`): `GET` → `{ newPerDay }`, `PATCH { newPerDay: 0–200 }` (no longer used since lessons replaced the daily allowance).

**Export** (`/api/export`): `GET` → a JSON download (`kquiz-YYYY-MM-DD.json`): `{ app, version, exportedAt, settings, cards (with reviewStates), reviewLog, attempts }`.

**Reviews** (`/api/reviews`)
- `GET /queue?mode=meaning|speech|listening&limit=50` → `{ items: [{ card, mode, due, state, reps, lapses }] }`, most overdue first with never-reviewed cards spread among them at random; speech only for speakable cards, listening only for cards whose recording is made from their current Korean (the phone's voice is no model for the ear), paused cards never; `mode=mixed` takes the most overdue items across all three modes (default 50, up to 200), each item keeping its own `mode` to be rated in, shuffled so one card's modes come at least 8 cards apart where possible
- `POST /` `{ reviews: [{ id: uuid, cardId, mode, rating: again|hard|good|easy, reviewedAt, elapsedMs? }] }` (≤ 200) → `{ results: [{ id, status: applied|duplicate|card_not_found, due? }] }`. A resent `id` is a no-op; a batch is applied in `reviewedAt` order.
- `GET /choices?cardIds=1,2,3` → `{ options: { [cardId]: [{ id, korean, meaning }] } }`: up to 3 wrong options per card for the "pick the Korean word" screen (`src/choices.ts`), from the user's own words of the same kind and length, never one whose translation overlaps the card's. The pick is rated in the `speech` schedule, as the quiet alternative to saying the word
- `GET /blocks?cardIds=1,2,3` → `{ tiles: { [cardId]: { blocks, decoys } } }` for the phrases among the cards: the blocks in order (its `parts` when they spell it, else its words, a one-word phrase cut before its ending) and 3–6 wrong ones: the same blocks with another particle or ending (화장실을 for 화장실이), then blocks of the user's other phrases and short words. Building is rated by the app: wrong `again`, slow `hard`, else `good`
- `GET /stats` → `{ cards, due: { meaning, speech, listening }, reviewedToday, newCards: { introduced, limit, queued } }` (day in `TIME_ZONE`)
- `GET /leeches` → `{ items: [{ card, forgotten: { meaning?, speech?, listening? }, lastForgottenAt }] }`: hard cards, forgotten on 6+ different days (UTC) in a mode since the card's last edit. Editing a card takes it off the list. Claude reads the same list with the MCP tool `get_leeches` and reworks the cards with `update_card`.
- `GET /fsrs` → `{ modes: [{ mode, desiredRetention, personal, reviews, minReviews, trainedOnReviews, optimizedAt }], retentionRange: { min, max } }`
- `PUT /fsrs` `{ mode, desiredRetention }` (0.85–0.95) → same as `GET /fsrs`

FSRS weights are fitted per person and mode to their own `review_log` (`src/fsrsOptimizer.ts`, fsrs-rs via `@open-spaced-repetition/binding`): first once a mode has 1000 reviews, then at most monthly when there are new ones. A fit is kept only if it predicts that history better than the current weights; then stability and difficulty are replayed with it, due dates stay. Days between reviews are counted in `TIME_ZONE` (default `Asia/Seoul`), starting at 4 am.

**Statistics** (`/api/stats`)
- `GET /?tz=540` (minutes east of UTC; days start at the owner's midnight) → `{ today, streak: { current, best, reviewedToday }, activity: [{ day, reviews }] (17 weeks), forecast: [{ day, due: { <mode>: n } }] (30 days, today includes overdue, new cards left out), retention: { <mode>: { reviews, recalled } } (30 days, without first sightings and reviews < 12 h apart), targetRetention: { <mode>: 0.9 }, cards: { total, byMode: { <mode>: { new, learning, young, mature } } }, speech: { weeks: [{ start, attempts, avgScore }] (8), sounds: [{ phone, attempts, errors, recent, previous }] } }`. Modes are whatever `review_states` holds, so a new mode appears without an API change. `sounds` are the worst by overall error rate (≥ 3 attempts); `recent` is the last 14 days, `previous` the 14 before.

**Pronunciation** (`/api/score`)
- `POST /?cardId=` with the recording as the body (`content-type: audio/wav`, ≤ 1 MB, ≤ 10 s; the web app sends 16 kHz mono 16-bit PCM) → `{ attemptId, cardId, score, pronunciation, syllables: [{ text, pron, status: ok|weak|wrong }], errors: [{ syllable, position, kind, status, expected, heard }], suggestedRating }`. Fields are the scorer's (services/scorer/README.md). With `&practice=1` (the one-word Learn flow) the attempt is not kept and `attemptId` is null, so it counts in no stats.
- Scoring is not a review: the app shows the result, the user picks the rating and it goes to `POST /api/reviews` with `mode: "speech"` like any other. `suggestedRating` is forgiving: "weak" syllables never pull it below good, because the model flags about one syllable in six even in fluent native speech.
- Every attempt is saved to `attempts` (no audio) and counted in `phone_stats` for `get_weak_sounds`; only "wrong" sounds count as errors there.
- 20 recordings a minute per client. Errors: `404` unknown card, `422 not_ready_for_speech` (non-Hangul card), `422 bad_recording` (not WAV, silence, too long), `503 busy` (with `Retry-After`) or `503 unavailable` (scorer down or model not loaded), `504 timeout`.

**Session logs** (`/api/session-logs`): what each learning session showed and what was answered, for Claude to look into a problem.
- `PUT /:id` `{ startedAt, screen, client?, tasks: [...], events: [...] }` → `{ ok: true }`. The app makes the id (6 characters of `23456789ABCDEFGHJKMNPQRSTUVWXYZ`) and sends the whole log again as the session goes on; an id that is another user's gets `409`. The latest 50 sessions per user are kept (`src/sessionLogs.ts`); tasks are kept as the app sends them (apps/web/src/lib/sessionLog.ts says what they hold).
- The user long-presses the progress bar or the heading at the end of a session to see and copy its id; Claude reads the log with the MCP tools `get_session_log` (by id, or the latest) and `list_session_logs`.

**Practice** (`/api/practice`): shadowing and sound drills; nothing here changes a schedule.
- `GET /audio?text=` → MP3 of an example sentence or drill word, `404` until the background worker has made it. The worker (`cardAudio.ts`) does cards first, then drill words, then examples, and keeps them in `speech_audio` by text.
- `GET /shadowing?limit=10` → `{ items: [{ cardId, word, meaning, ko, ru }] }`: one voiced example per card, studied cards first, random order. The intonation curve is computed in the browser (apps/web/src/lib/intonation.ts), so the server does no pitch work.
- `GET /drills` → `{ drills: [{ id, contrast, words: [{ korean, meaning }], correct, wrong, ready }] }`, the most missed first. Claude adds drills over MCP (`add_sound_drills`).
- `POST /drills/:id/answers` `{ correct }`, `DELETE /drills/:id` (the app only).

## MCP server

`src/server.ts` mounts `/api` and the MCP app (`src/mcp/`) on one Hono server. The MCP app gets `sqliteStores()` (each person's `SqliteCardStore` and `SqliteDrillStore`), `SqliteOAuthStore` and `ownerAuth()` from `src/storage/mcp.ts`. A grant belongs to whoever approved it on the consent page and works only on their cards. MCP card ids are the numeric ids as strings. The OAuth consent sends the user to the web app's `/login?fresh=1&return_to=…`, which always asks for a passkey; consent then counts the session as fresh for 5 minutes.
