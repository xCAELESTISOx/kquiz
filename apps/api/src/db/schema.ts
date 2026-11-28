import { sql } from "drizzle-orm";
import type { Example, PhrasePart, Root } from "../cards.js";
import type { CardPictureRef } from "../pictures.js";
import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

// People who can sign in. The owner (id 1, made by migration 0008) runs the server and invites
// others; a member has their own cards, schedule and stats and nothing else. Disabled members
// can't sign in, their data stays until the owner deletes it.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull(),
  // WebAuthn user handle, so each person's passkey is a separate entry on a shared device.
  webauthnId: text("webauthn_id").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  disabledAt: timestamp("disabled_at"),
});

const userId = () =>
  integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// One-time links that let a new member bind their first passkey (auth/invites.ts).
export const invites = sqliteTable("invites", {
  // SHA-256 of the code in the link; the code itself is never stored.
  codeHash: text("code_hash").primaryKey(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedBy: integer("used_by").references(() => users.id, { onDelete: "set null" }),
});

export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    korean: text("korean").notNull(),
    // Normalized Korean, the key for duplicate detection.
    koreanKey: text("korean_key").notNull(),
    meaning: text("meaning").notNull(),
    pronunciation: text("pronunciation"),
    romanization: text("romanization"),
    examples: text("examples", { mode: "json" }).$type<Example[]>().notNull().default(sql`'[]'`),
    notes: text("notes"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // Sino-Korean roots (cards.ts rootSchema). Null: not filled in yet; []: a native word, no roots.
    roots: text("roots", { mode: "json" }).$type<Root[]>(),
    // A word, or a set phrase learned whole (안녕히 가세요). A phrase has no examples: `parts` breaks it
    // into its pieces instead, and it is built from blocks rather than translated (phrases.ts).
    kind: text("kind", { enum: ["word", "phrase"] }).notNull().default("word"),
    parts: text("parts", { mode: "json" }).$type<PhrasePart[]>(),
    // How polite a phrase is: 합쇼체, 해요체 or 반말.
    register: text("register", { enum: ["formal", "polite", "casual"] }),
    speakable: integer("speakable", { mode: "boolean" }).notNull(),
    source: text("source", { enum: ["app", "claude", "bulk"] }).notNull(),
    language: text("language").notNull().default("ko"),
    // Paused: kept with its schedule, but out of every review queue until resumed.
    suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
    // Null while the card waits to be learned (newCards.ts); it has no review states until then.
    // `introduction` says how it left: learned, pulled in early by hand, or, before lessons, added
    // directly or let in by the old daily allowance.
    introducedAt: timestamp("introduced_at"),
    introduction: text("introduction", { enum: ["direct", "daily", "early", "learned"] }),
    // Learning a new word (newCards.ts): picked from the pool into the few being learned, the ladder
    // steps passed in a row, and when the ladder was done (the word then waits for its later check).
    learningAt: timestamp("learning_at"),
    learnStep: integer("learn_step").notNull().default(0),
    learnPassedAt: timestamp("learn_passed_at"),
    // When the word first got an answer on its ladder: met already, so back on step 0 after a miss it
    // is built again, not met again as a new word.
    learnMetAt: timestamp("learn_met_at"),
    // Set when the owner skips the word as it is met: from then on it waits at the back of the pool,
    // after every word added before that (newCards.ts poolOrder).
    skippedAt: timestamp("skipped_at"),
    // The word's picture (pictures.ts): its own, the library's for this word, or switched off.
    // Null: none yet; looked up in the library again whenever the library or the word changes.
    picture: text("picture", { mode: "json" }).$type<CardPictureRef>(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("cards_user_korean_key").on(t.userId, t.koreanKey), index("cards_introduced").on(t.introducedAt)],
);

// Words easy to mix up (휴지통 / 쓰레기통, 아래 / 밑), linked both ways (similar.ts). One row per pair,
// the smaller card id first; `note` says how the two differ.
export const similarWords = sqliteTable(
  "similar_words",
  {
    userId: userId(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    otherId: integer("other_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.otherId] }), index("similar_words_other").on(t.otherId)],
);

// Each user's settings as key → JSON value (settings.ts).
export const settings = sqliteTable(
  "settings",
  {
    userId: userId(),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

// Reference audio from services/scorer's /tts, one MP3 per card. `text` is the Korean it was
// made from: when the card's Korean changes, the audio is stale and gets made again.
export const cardAudio = sqliteTable("card_audio", {
  cardId: integer("card_id")
    .primaryKey()
    .references(() => cards.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  mime: text("mime").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const reviewStates = sqliteTable(
  "review_states",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["meaning", "speech", "listening"] }).notNull(),
    due: timestamp("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsedDays: integer("elapsed_days").notNull(),
    scheduledDays: integer("scheduled_days").notNull(),
    learningSteps: integer("learning_steps").notNull(),
    reps: integer("reps").notNull(),
    lapses: integer("lapses").notNull(),
    state: integer("state").notNull(),
    lastReview: timestamp("last_review"),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.mode] }), index("review_states_due").on(t.mode, t.due)],
);

export const reviewLog = sqliteTable(
  "review_log",
  {
    // UUID generated by the client, so a resent offline review is applied once.
    id: text("id").primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["meaning", "speech", "listening"] }).notNull(),
    rating: text("rating", { enum: ["again", "hard", "good", "easy"] }).notNull(),
    reviewedAt: timestamp("reviewed_at").notNull(),
    elapsedMs: integer("elapsed_ms"),
  },
  (t) => [index("review_log_card").on(t.cardId)],
);

// Per-mode FSRS setup. No row means FSRS defaults at 90 % retention. `weights` stays null until
// the optimizer has fitted the owner's own review history and the fit beat the current weights.
export const fsrsSettings = sqliteTable(
  "fsrs_settings",
  {
    userId: userId(),
    mode: text("mode", { enum: ["meaning", "speech", "listening"] }).notNull(),
    desiredRetention: real("desired_retention").notNull().default(0.9),
    weights: text("weights", { mode: "json" }).$type<number[]>(),
    // Size of the history behind `weights`, and when the optimizer last ran (accepted or not).
    trainedOnReviews: integer("trained_on_reviews"),
    optimizedAt: timestamp("optimized_at"),
    checkedAt: timestamp("checked_at"),
    checkedOnReviews: integer("checked_on_reviews"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mode] })],
);

export const authCredentials = sqliteTable("auth_credentials", {
  id: text("id").primaryKey(),
  userId: userId(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull(),
  transports: text("transports", { mode: "json" }).$type<string[]>(),
  deviceType: text("device_type"),
  backedUp: integer("backed_up", { mode: "boolean" }),
  name: text("name"),
  createdAt: timestamp("created_at").notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  kind: text("kind", { enum: ["register", "login"] }).notNull(),
  // The WebAuthn user handle a registration was offered with, so verify stores the same one.
  userHandle: text("user_handle"),
  expiresAt: timestamp("expires_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  // SHA-256 of the cookie value; the cookie itself is never stored.
  tokenHash: text("token_hash").primaryKey(),
  userId: userId(),
  csrfToken: text("csrf_token").notNull(),
  credentialId: text("credential_id"),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  userAgent: text("user_agent"),
});

// One row per scored recording. The audio itself is not kept.
export const attempts = sqliteTable(
  "attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull(),
    score: integer("score").notNull(),
    targetPhones: text("target_phones", { mode: "json" }).$type<string[]>().notNull(),
    heardPhones: text("heard_phones", { mode: "json" }).$type<string[]>().notNull(),
    syllables: text("syllables", { mode: "json" }).$type<unknown[]>().notNull(),
    errors: text("errors_json", { mode: "json" }).$type<unknown[]>().notNull(),
  },
  (t) => [index("attempts_card").on(t.cardId, t.createdAt)],
);

// Filled by pronunciation attempts (stage 4), per user; read by the weak-sounds stats and Claude.
export const phoneStats = sqliteTable(
  "phone_stats",
  {
    userId: userId(),
    phone: text("phone").notNull(),
    attempts: integer("attempts").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    lastSeen: timestamp("last_seen"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.phone] })],
);

// OAuth for Claude's MCP connector. Times are epoch milliseconds, secrets are SHA-256 hashes.
export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  secretHash: text("secret_hash"),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at").notNull(),
  approvedAt: integer("approved_at"),
});

export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  // Who approved the client on the consent page: the grant works on that person's cards.
  userId: userId(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const oauthGrants = sqliteTable(
  "oauth_grants",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
    accessHash: text("access_hash").notNull(),
    accessExpiresAt: integer("access_expires_at").notNull(),
    refreshHash: text("refresh_hash").notNull(),
    refreshExpiresAt: integer("refresh_expires_at").notNull(),
    usedRefreshHashes: text("used_refresh_hashes", { mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [uniqueIndex("oauth_grants_access").on(t.accessHash), uniqueIndex("oauth_grants_refresh").on(t.refreshHash)],
);

// Reference audio for any other Korean text, keyed by the text itself: card example sentences
// (shadowing) and the words of sound drills. Made by the same worker as card_audio.
export const speechAudio = sqliteTable("speech_audio", {
  text: text("text").primaryKey(),
  mime: text("mime").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

// The same texts read by other voices than the default one (voices.ts), for listening: hearing a
// word in several voices trains the ear on the sound rather than on one speaker's timbre.
export const voiceAudio = sqliteTable(
  "voice_audio",
  {
    text: text("text").notNull(),
    voice: text("voice").notNull(),
    mime: text("mime").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.text, t.voice] })],
);

// Listening drills on similar sounds (ㄱ/ㅋ/ㄲ): 2–4 words that differ in one sound, picked by Claude.
export const soundDrills = sqliteTable(
  "sound_drills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    // What the words contrast, as shown to the owner, e.g. "ㄱ/ㅋ/ㄲ".
    contrast: text("contrast").notNull(),
    words: text("words", { mode: "json" }).$type<{ korean: string; meaning?: string }[]>().notNull(),
    // Sorted words joined by "|", so the same set is not added twice.
    wordsKey: text("words_key").notNull(),
    source: text("source", { enum: ["app", "claude"] }).notNull(),
    correct: integer("correct").notNull().default(0),
    wrong: integer("wrong").notNull().default(0),
    lastPracticedAt: timestamp("last_practiced_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("sound_drills_user_words").on(t.userId, t.wordsKey)],
);

// What happened in each learning session, task by task, so Claude can look into a problem the
// user saw (MCP get_session_log). The id is short so it can be copied and pasted; the app makes it.
export const sessionLogs = sqliteTable(
  "session_logs",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    startedAt: timestamp("started_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("session_logs_user").on(t.userId, t.startedAt)],
);

// Pictures of words, stored once by the hash of their processed bytes (pictures.ts): a changed
// picture is a new row, so its URL changes too and caches can keep a picture forever.
export const pictures = sqliteTable("pictures", {
  hash: text("hash").primaryKey(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  // The Korean is written on it, so it can't show while the word is being recalled.
  hasText: integer("has_text", { mode: "boolean" }).notNull().default(false),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

// A picture for a word, whoever has it in their deck: a card with no picture of its own takes the
// library's for its Korean. Filled by importing a picture pack (routes/pictures.ts).
export const pictureLibrary = sqliteTable("picture_library", {
  koreanKey: text("korean_key").primaryKey(),
  korean: text("korean").notNull(),
  meaning: text("meaning"),
  topic: text("topic"),
  pictureHash: text("picture_hash")
    .notNull()
    .references(() => pictures.hash, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at").notNull(),
});

// Every task answered in a session (taken from its session log, taskStats.ts), kept after the log
// itself is dropped: which words go wrong most often, and which kinds of task go well or badly.
// `missed` is a wrong first try, even when a second try got it right.
export const taskAnswers = sqliteTable(
  "task_answers",
  {
    logId: text("log_id").notNull(),
    n: integer("n").notNull(),
    userId: userId(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    missed: integer("missed", { mode: "boolean" }).notNull(),
    /** main, fix (going over mistakes) or extra (practice off the schedule); null only before 0023's backfill. */
    phase: text("phase", { enum: ["main", "fix", "extra"] }),
    /** Right with a hint, slow, or with a slip. */
    soft: integer("soft", { mode: "boolean" }).notNull().default(false),
    /** Missed at first, right in the end ("After a try"). */
    recovered: integer("recovered", { mode: "boolean" }).notNull().default(false),
    answeredAt: timestamp("answered_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.logId, t.n] }), index("task_answers_user").on(t.userId, t.answeredAt)],
);

// Grammar mode (grammar.ts): constructions learned like words, with their own ladder, schedule and
// stats. A sentence keeps only the slot (dictionary form + how it is used); the finished form is
// built by rule (@kquiz/korean), never stored.
export const grammarPoints = sqliteTable(
  "grammar_points",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    // As textbooks write it: -아/어야 하다, -(으)ㄹ 수 있다, 못, -을/를 앞두고.
    pattern: text("pattern").notNull(),
    meaning: text("meaning").notNull(),
    // use: for speaking, learned up to typing the form; recognize: only to understand when reading.
    goal: text("goal", { enum: ["use", "recognize"] }).notNull().default("use"),
    explanation: text("explanation"),
    // A typical mistake, "✗ … ✓ …".
    trap: text("trap"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // Like new words: waiting in the pool (learning_at null), on the ladder, waiting for the check,
    // then learned (learned_at, and a grammar_states row).
    learningAt: timestamp("learning_at"),
    learnStep: integer("learn_step").notNull().default(0),
    learnPassedAt: timestamp("learn_passed_at"),
    learnedAt: timestamp("learned_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("grammar_points_user_pattern").on(t.userId, t.pattern)],
);

export const grammarSentences = sqliteTable(
  "grammar_sentences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pointId: integer("point_id")
      .notNull()
      .references(() => grammarPoints.id, { onDelete: "cascade" }),
    // The sentence around the slot. A sentence without a slot (lemma null) is only read.
    before: text("before").notNull(),
    after: text("after").notNull().default(""),
    lemma: text("lemma"),
    pos: text("pos", { enum: ["verb", "adjective", "copula", "noun"] }),
    // Conjugation class when the built-in one is wrong for this word (묻다 "bury", 이르다 "arrive").
    cls: text("cls"),
    // The construction on this sentence when it differs from the point's (-(으)ㄴ for the past of -는).
    pattern: text("pattern"),
    // How the last predicate ends: { style, tense, question, ending } (@kquiz/korean Final).
    final: text("final", { mode: "json" }).$type<Record<string, unknown>>(),
    translation: text("translation").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("grammar_sentences_point").on(t.pointId)],
);

// Constructions easy to mix up (-고 / -아서, 안 / 못), linked both ways, the smaller id first.
export const grammarSimilar = sqliteTable(
  "grammar_similar",
  {
    pointId: integer("point_id")
      .notNull()
      .references(() => grammarPoints.id, { onDelete: "cascade" }),
    otherId: integer("other_id")
      .notNull()
      .references(() => grammarPoints.id, { onDelete: "cascade" }),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.pointId, t.otherId] })],
);

export const grammarStates = sqliteTable(
  "grammar_states",
  {
    pointId: integer("point_id")
      .primaryKey()
      .references(() => grammarPoints.id, { onDelete: "cascade" }),
    due: timestamp("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsedDays: integer("elapsed_days").notNull(),
    scheduledDays: integer("scheduled_days").notNull(),
    learningSteps: integer("learning_steps").notNull(),
    reps: integer("reps").notNull(),
    lapses: integer("lapses").notNull(),
    state: integer("state").notNull(),
    lastReview: timestamp("last_review"),
  },
  (t) => [index("grammar_states_due").on(t.due)],
);

// Every grammar task answered: the ladder, checks, reviews and practice. The source of the
// schedule's history and of the grammar stats (by task and by conjugation class).
export const grammarAnswers = sqliteTable(
  "grammar_answers",
  {
    // UUID from the client, so a resent answer counts once.
    id: text("id").primaryKey(),
    userId: userId(),
    pointId: integer("point_id")
      .notNull()
      .references(() => grammarPoints.id, { onDelete: "cascade" }),
    sentenceId: integer("sentence_id"),
    task: text("task").notNull(),
    // learn (ladder), check, review (FSRS), fix (mistakes at the end), extra (off the schedule).
    phase: text("phase", { enum: ["learn", "check", "review", "fix", "extra"] }).notNull(),
    outcome: text("outcome", { enum: ["right", "soft", "wrong"] }).notNull(),
    // The conjugation class of the slot's word, for "where you slip" (regular, b, d, l…).
    cls: text("cls"),
    answeredAt: timestamp("answered_at").notNull(),
    elapsedMs: integer("elapsed_ms"),
  },
  (t) => [index("grammar_answers_user").on(t.userId, t.answeredAt), index("grammar_answers_point").on(t.pointId)],
);
