# KQuiz: design and architecture

KQuiz is a self-hosted app for learning Korean vocabulary: flashcards with spaced repetition, cards added straight from Claude over MCP, and pronunciation practice scored sound by sound. One server runs it for its owner and a few invited people, each with their own deck.

This document explains what the system is made of and why. The API reference lives in [`apps/api/README.md`](../apps/api/README.md), the scorer in [`services/scorer/README.md`](../services/scorer/README.md), and self-hosting in [`DEPLOY.md`](DEPLOY.md). Section numbers are stable: code comments refer to them (for example "PLAN.md §4.3").

## 1. Goals and what follows from them

| Goal | What it means for the architecture |
|---|---|
| Adding cards is fast | The Add screen is one tap away and needs only two fields (Korean and a translation); pronunciation and romanization are filled in automatically. A bulk mode takes a pasted list. |
| Cards can come from Claude | The backend has its own MCP server. Claude sees tools such as `add_cards` and `find_cards` and writes straight into the database. |
| Pleasant on a phone | Own design system: dark theme only, color tokens, large touch targets, mobile-first, installable on any phone or desktop. |
| Private by default | No public sign-up. Sign-in is by passkey only. The owner binds the first passkey with a one-time code from the server log and invites up to four more people by one-time links. A new passkey can be added only from a signed-in session, so changing phones never locks anyone out. |
| An attack can't run up a bill | Nothing is billed per request or per byte. One fixed-price server; the worst an attack can do is make the app unavailable. |
| Practice both meaning and speech | Each card is reviewed in several modes, each with its own FSRS schedule: `meaning` (recognize the word), `speech` (say it aloud and get it scored, or pick the Korean word as a quiet alternative) and `listening` (hear it, no text). |
| Korean only, for now | The code is not generalized to other languages. The language is one column in the data model, so the schema doesn't have to change if that ever happens. |

## 2. Key decisions and why

1. **Own storage, not a third-party flashcard service.** Fast adding and a good interface need their own screens and therefore their own database. It also removes third-party API keys, quotas and the risk of the service shutting down. Spaced repetition comes from a library: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT), with per-user weights fitted by fsrs-rs.
2. **TypeScript everywhere except pronunciation scoring.** The client and the main backend are TypeScript. Python is used only in a separate internal scoring service, because the acoustic models, g2p and TTS live in that ecosystem.
3. **One fixed-price server.** A small VPS with traffic included. No pay-per-call serverless, no autoscaling, no paid APIs without a hard cap.
4. **The scorer is never exposed.** The Python service listens on `127.0.0.1` only; the API calls it after checking the session and the rate limits.
5. **A PWA, not a native app.** No App Store account or Mac build machine is needed. The PWA installs to the home screen on iPhone and Android and as an app on desktop; a service worker caches the app shell for speed.

## 3. Architecture

```
Phone / desktop (PWA)            Claude (claude.ai, desktop, mobile)
        │  HTTPS                          │  HTTPS, MCP + OAuth 2.1
        ▼                                 ▼
  ┌──────────────────────── fixed-price VPS ─────────────────────────┐
  │ Caddy :443 (Let's Encrypt)                                       │
  │   ├─ static PWA (apps/web/dist)                                  │
  │   └─ /api, /mcp, /oauth, /.well-known → api 127.0.0.1:8787       │
  │                                                                  │
  │ api (Node 22, Hono)                                              │
  │   ├─ REST for the PWA                                            │
  │   ├─ /mcp for Claude, OAuth 2.1 with dynamic client registration │
  │   ├─ background workers: card audio, FSRS optimizer              │
  │   └─ SQLite (cards, schedules, review log, attempts, audio)      │
  │                 │ 127.0.0.1:8788                                 │
  │                 ▼                                                │
  │ scorer (Python, FastAPI): g2p, wav2vec2 phone model, TTS         │
  └──────────────────────────────────────────────────────────────────┘
```

Everything is served from one domain, so there is no CORS and cookies stay simple. The three parts run as Docker containers on the host network (see [`deploy/docker-compose.yml`](../deploy/docker-compose.yml)).

## 4. Components

### 4.1. `apps/web`: the PWA

- React + Vite + TypeScript, a small hand-written router (`src/lib/router.ts`), no state library.
- Offline tolerance: every rating goes through a local queue in `localStorage` and is sent in batches. Each rating carries its own UUID, so resending is safe. The service worker caches the app shell for speed; it is not a full offline mode.
- Audio is recorded through Web Audio (an AudioWorklet) as 16 kHz mono PCM, and the WAV is assembled on the client. MediaRecorder is avoided because of an iOS bug in home-screen PWAs and Safari's `audio/mp4` output.
- Reference audio: an MP3 made once per card by the server-side TTS (Supertonic 3 in `services/scorer`); until it exists, the browser's `speechSynthesis` with a `ko-KR` voice.
- In development, when the API isn't running, the client falls back to a `localStorage` mock (`src/lib/mock.ts`).

Main screens:

| Screen | What it does |
|---|---|
| Today | What is due in each mode, new words waiting to be learned, a quick "+" |
| Learn | Teaches new words a few at a time on a short ladder of tasks before they enter reviews |
| Review | Prompt → reveal → answer with pronunciation and examples → Again / Hard / Good / Easy |
| Speech | Translation → recall → listen → record → syllables marked ok / weak / wrong → a suggested rating; the learner picks the final one |
| Add | Korean + translation, the rest is filled in. Bulk mode: lines like `한국어 — translation` |
| Cards | Search, tag and root filters, editing, cards not ready for speech |
| Practice | Shadowing of example sentences with an intonation curve, and minimal-pair sound drills |
| Stats | Streak, workload forecast, retention, weakest sounds |

### 4.2. `apps/api`: the main backend

- Node 22, [Hono](https://hono.dev), SQLite through `better-sqlite3`, schema and migrations with Drizzle, validation with zod.
- REST for the PWA, an MCP endpoint for Claude, and an OAuth 2.1 server whose grants are tied to the person who approved them.
- The schedule is computed on the server by ts-fsrs; the client sends only the rating.
- Normalization on add: whitespace is trimmed, `korean` is checked to be Hangul and punctuation only, duplicates are found by the normalized Korean text.
- Autofill: pronunciation in Hangul (g2p) and romanization come from the scorer.
- Background workers: one asks the scorer for card audio and stores it in SQLite (so it is part of every backup); the other refits FSRS weights from each user's own review history.

### 4.3. `services/scorer`: pronunciation scoring

The pipeline for one recording:

1. Decode the WAV, trim silence with ~200 ms of margin, normalize loudness.
2. Recognize phones with [slplab/wav2vec2-xls-r-300m_phone-mfa_korean](https://huggingface.co/slplab/wav2vec2-xls-r-300m_phone-mfa_korean) (Apache-2.0).
3. Reference: text → [g2pkiwi](https://github.com/Bing-su/g2pkiwi) → spoken form → jamo → MFA-style IPA.
4. Weighted Levenshtein alignment: close substitutions (ㄱ/ㅋ/ㄲ, ㅓ/ㅗ) cost less than distant ones. Equivalences of standard Seoul speech (ㅐ = ㅔ, ㅚ ≈ [we]) are not penalized.
5. Per-sound confidence (goodness of pronunciation from the CTC outputs).
6. Result: a score of 0–100, syllables marked ok / weak / wrong, and for each error what was expected and what was heard.

Fallbacks if the model struggles with non-native speech: a jamo-level model (Kkonjeong/wav2vec2-base-korean) or fine-tuning on one's own recordings. If CPU inference is too slow: ONNX export with int8 quantization.

The same service also synthesizes reference audio with Supertonic 3 (`POST /tts`).

## 5. Data model (SQLite)

A card has one set of fields and is reviewed in several modes. The authoritative schema is [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts); the main tables:

| Table | Purpose |
|---|---|
| `users`, `invites` | The owner (id 1) and invited members; one-time invite links |
| `cards` | The card: Korean, translation, pronunciation, romanization, up to three examples, notes, tags, Sino-Korean roots, `kind` (word or phrase), phrase parts and register, source (`app` / `claude` / `bulk`), learning state |
| `similar_words` | Pairs of the user's words that are easy to confuse, with a note on how they differ |
| `review_states` | FSRS state per card and mode (`meaning` / `speech` / `listening`) |
| `review_log` | Every rating, keyed by the client's UUID (idempotent resends) |
| `fsrs_settings` | Per-user, per-mode desired retention and fitted weights |
| `attempts`, `phone_stats` | Scored pronunciation attempts (no audio is kept) and per-sound error counts |
| `card_audio`, `speech_audio`, `voice_audio` | Generated MP3s for cards, example sentences and extra voices |
| `sound_drills` | Minimal-pair drills for weak sounds |
| `auth_*`, `oauth_*` | Passkeys, challenges, sessions, OAuth clients, codes and grants |

Rules:
- `korean` holds only Hangul, spaces and punctuation. Anything else is saved but marked not ready for speech and never enters the speech queue.
- Long phrases are not `speakable` by default; they can be switched on by hand.
- Backups are nightly copies of the single SQLite file (`sqlite3 .backup`, see [`deploy/backup.sh`](../deploy/backup.sh)). The app can also export everything as JSON.

## 6. Claude: the MCP server

The endpoint is `https://<your-domain>/mcp`, Streamable HTTP transport, built on the official `@modelcontextprotocol/sdk`.

Tools:

| Tool | What it does |
|---|---|
| `add_cards` | Up to 50 cards at once. Returns what was created, duplicates, and rejections with reasons |
| `add_phrases` | Up to 50 set phrases: instead of examples, a breakdown into parts and a politeness register |
| `find_cards` | Search by Korean, translation or tag |
| `update_card` | Edit the fields of one card |
| `set_roots` | Fill in Sino-Korean roots (hanja) of older cards |
| `link_similar` | Link or unlink two easily confused words, with a note |
| `get_weak_sounds` | Sounds with the highest error rate, so Claude can pick words that train them |
| `get_leeches` | Cards forgotten again and again, for Claude to rework |
| `get_stats` | Card counts, what is due, the streak |
| `add_sound_drills`, `list_sound_drills` | Minimal-pair drills for weak sounds |

There is no delete over MCP: cards are deleted only in the app.

Access: Claude supports remote MCP servers with OAuth and Dynamic Client Registration ([Anthropic's guide](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)). The API runs a minimal OAuth 2.1 server: Claude registers as a client, opens the consent page, the user confirms with a passkey, and Claude gets a token. Tokens are short-lived with refresh and can be revoked. Client registrations are capped so dynamic registration can't be used to fill the database. Allowed redirect URIs default to Claude's callbacks and can be changed with `MCP_REDIRECT_URIS`; loopback callbacks on any port (RFC 8252) are accepted too, for command-line clients like Claude Code and Codex, unless `MCP_ALLOW_LOOPBACK=0`. PKCE is required for every client.

## 7. Security and cost control

Principle: **the server costs a fixed amount whatever happens.** An attack can take the service down, but it can't produce a bill.

Cost:
- A VPS with a fixed monthly price and traffic included, no usage-billed add-ons.
- No paid APIs (cloud TTS, speech recognition, LLMs). Everything runs on the server's CPU.

Network:
- Only Caddy (80 and 443) and SSH (keys only) are open; `ufw` closes the rest. The API and the scorer listen on `127.0.0.1`.
- Caddy adds a secret header (`x-kquiz-origin`, value `ORIGIN_SECRET`) and the client IP (`cf-connecting-ip`) to every request it forwards. The API refuses requests without the secret, so nothing reaches it around Caddy, and clients can't spoof their IP to escape the limits. The header names come from an earlier setup with Cloudflare in front; if you put a CDN in front of Caddy, make sure the real client IP still reaches the API.

Application:
- Every endpoint except sign-in and OAuth metadata needs a session or a token.
- The session is an httpOnly, Secure, SameSite=Strict cookie; changing requests also need a CSRF token.
- Passkeys only. The first one is bound with a one-time code printed to the server log; every later one only from a signed-in session.
- Rate limits in the API itself, per client: sign-in 5 a minute, scoring 20 a minute, MCP 60 a minute, the rest of the API 300 a minute. Invited members also have daily quotas for cards and recordings.
- Scoring: recordings of at most 10 s and 1 MB, one job at a time, 15 s timeout. This protects the CPU and so the availability.
- Request bodies are capped in Caddy (2 MB) and in the API (1 MB).
- Voice recordings are not stored; only the scores are.
- Dependabot updates dependencies; containers run as non-root with read-only file systems and memory limits.

## 8. Design

- Dark theme only: an almost black background with a slight blue tint, surfaces 4–8 % lighter, one accent color. Pronunciation statuses: ok green, weak amber, wrong red, all checked against WCAG AA contrast.
- Typeface [Pretendard](https://github.com/orioncactus/pretendard) (OFL), which works well for Hangul, Latin and Cyrillic alike.
- The Korean word is the largest element on a card; pronunciation and translation are secondary.
- Touch targets of at least 44 px, primary actions in the bottom third of the screen within thumb reach, iPhone safe areas respected.
- Short animations (150–250 ms), turned off under `prefers-reduced-motion`.

## 9. Validation (stage 0)

The project started by checking its three riskiest assumptions before building anything else:

- **Recording in a home-screen PWA on iPhone.** A test page with an AudioWorklet, added to the home screen, ten recordings with the app closed and reopened in between.
- **The scoring model.** A script over 30–50 of one's own recordings and TTS references. Criterion: references score ≥ 90, deliberately mispronounced sounds are caught in most cases. CPU speed is measured too. The harness is still in the repository: `python -m app.eval` in `services/scorer` (see its README).
- **MCP.** A minimal server with OAuth on a test domain, connected from Claude, with one `add_cards` call.

The rest was built in stages on top of that: the API with passkeys and FSRS, the PWA screens, the MCP server, pronunciation scoring, then server-side TTS, sound drills, intonation comparison and multi-user support.

## 10. Open questions

- A "type the word in Korean" mode next to "recognize" and "say" exists in the app; whether it deserves its own FSRS schedule is still open.
- The scorer thresholds in `services/scorer/app/scoring.py` were tuned on a small set of recordings and may need adjusting for other speakers.
