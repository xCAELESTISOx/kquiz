import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCards } from "../cardStore.js";
import { createReviewing } from "../testing.js";
import { openDb } from "./client.js";
import { cards, reviewStates, users } from "./schema.js";
import { OWNER_ID } from "../users.js";

/** Applies the repository's migrations up to and including `idx`, foreign keys off as openDb does. */
function migrateUpTo(sqlite: Database.Database, dir: string, idx: number) {
  const folder = join(dir, `migrations-${idx}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= idx);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) {
    copyFileSync(new URL(`../../drizzle/${e.tag}.sql`, import.meta.url), join(folder, `${e.tag}.sql`));
  }
  sqlite.pragma("foreign_keys = OFF");
  migrate(drizzle(sqlite), { migrationsFolder: folder });
}

describe("migrations", () => {
  it("0004 gives cards made before listening mode a fresh listening schedule", () => {
    const db = openDb(":memory:");
    createReviewing(db, OWNER_ID, [{ korean: "물", meaning: "вода", tags: [] }], "app");
    db.$client.exec("delete from review_states where mode = 'listening'");
    db.$client.exec(readFileSync(new URL("../../drizzle/0004_listening.sql", import.meta.url), "utf8"));
    const modes = db.select({ mode: reviewStates.mode, reps: reviewStates.reps }).from(reviewStates).all();
    expect(modes.map((m) => m.mode).sort()).toEqual(["listening", "meaning", "speech"]);
    expect(modes.every((m) => m.reps === 0)).toBe(true);
  });

  it("0005 counts cards made before the new-card queue as already introduced", () => {
    const db = openDb(":memory:");
    createCards(db, OWNER_ID, [{ korean: "물", meaning: "вода", tags: [] }], "claude");
    expect(db.select({ at: cards.introducedAt }).from(cards).get()?.at).toBeNull();
    db.$client.exec(readFileSync(new URL("../../drizzle/0005_card_queue.sql", import.meta.url), "utf8").split("--> statement-breakpoint").at(-1)!);
    const row = db.select({ at: cards.introducedAt, how: cards.introduction, created: cards.createdAt }).from(cards).get();
    expect(row).toMatchObject({ how: "direct", at: row?.created });
  });

  it("0014 sends words never reviewed back to wait to be learned, and keeps the rest", () => {
    const db = openDb(":memory:");
    const { created } = createReviewing(db, OWNER_ID, [{ korean: "물", meaning: "вода", tags: [] }, { korean: "불", meaning: "огонь", tags: [] }], "app");
    const [seen, fresh] = created.map((c) => c.id);
    db.update(reviewStates).set({ reps: 1 }).where(and(eq(reviewStates.cardId, seen!), eq(reviewStates.mode, "speech"))).run();
    // The columns are there already (openDb migrates); the data part is what is tested.
    db.$client.exec(readFileSync(new URL("../../drizzle/0014_learn_new_words.sql", import.meta.url), "utf8").split("--> statement-breakpoint").slice(3).join("\n"));
    const rows = db.select({ id: cards.id, at: cards.introducedAt, how: cards.introduction }).from(cards).all();
    expect(rows.find((r) => r.id === fresh)).toMatchObject({ at: null, how: null });
    expect(rows.find((r) => r.id === seen)?.at).not.toBeNull();
    const states = db.select({ cardId: reviewStates.cardId }).from(reviewStates).all();
    expect(states.every((s) => s.cardId === seen)).toBe(true);
    expect(states).toHaveLength(3);
  });
});

describe("migration 0008 (users)", () => {
  it("gives everything stored before it to the owner without losing a row", () => {
    // A database as it was at 0007, with a card, its schedule, history, audio and the rest.
    const dir = mkdtempSync(join(tmpdir(), "kquiz-0008-"));
    const file = join(dir, "kquiz.db");
    const sqlite = new Database(file);
    migrateUpTo(sqlite, dir, 7);
    sqlite.exec(`
      insert into cards (id, korean, korean_key, meaning, examples, tags, speakable, source, created_at, updated_at, introduced_at, introduction)
        values (7, '물', '물', 'вода', '[]', '[]', 1, 'app', 1, 1, 1, 'direct');
      insert into review_states values (7, 'meaning', 5, 1, 5, 0, 1, 0, 1, 0, 2, 1);
      insert into review_log values ('r1', 7, 'meaning', 'good', 1, null);
      insert into attempts (card_id, created_at, score, target_phones, heard_phones, syllables, errors_json) values (7, 1, 90, '[]', '[]', '[]', '[]');
      insert into card_audio values (7, '물', 'audio/mpeg', x'00', 1);
      insert into settings values ('newPerDay', '5');
      insert into fsrs_settings (mode, desired_retention) values ('meaning', 0.85);
      insert into phone_stats values ('m', 3, 1, 1);
      insert into sound_drills (contrast, words, words_key, source, created_at) values ('ㅂ/ㅍ', '[]', '불|풀', 'claude', 1);
      insert into auth_credentials (id, public_key, counter, created_at) values ('cred', 'key', 0, 1);
      insert into auth_sessions values ('tok', 'csrf', 'cred', 1, 99999999999999, null);
      insert into oauth_clients values ('c', null, 'Claude', '[]', 1, 1);
      insert into oauth_grants values ('g', 'c', 'cards', 1, 1, 'a', 2, 'r', 3, '[]');
    `);
    // Up to 0011: 0013 later wipes the owner's learning on purpose.
    migrateUpTo(sqlite, dir, 11);
    sqlite.close();

    const reopened = new Database(file);
    const count = (table: string) => (reopened.prepare(`select count(*) n from ${table} where user_id = 1`).get() as { n: number }).n;
    for (const table of ["cards", "settings", "fsrs_settings", "phone_stats", "sound_drills", "auth_credentials", "auth_sessions", "oauth_grants"]) {
      expect(count(table), table).toBe(1);
    }
    const rows = (table: string) => (reopened.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;
    expect([rows("review_states"), rows("review_log"), rows("attempts"), rows("card_audio")]).toEqual([1, 1, 1, 1]);
    const view = drizzle(reopened, { schema: { users, cards } });
    expect(view.select().from(users).all()).toMatchObject([{ id: 1, role: "owner", webauthnId: "a3F1aXotb3duZXI" }]);
    expect(view.select({ id: cards.id }).from(cards).get()).toEqual({ id: 7 });
    reopened.close();
    rmSync(dir, { recursive: true });
  });
});

describe("migrations 0012 and 0013 (fresh start keeping audio)", () => {
  it("wipe the owner's learning, keep their account, friends' data and every recording", () => {
    const dir = mkdtempSync(join(tmpdir(), "kquiz-0013-"));
    const file = join(dir, "kquiz.db");
    const sqlite = new Database(file);
    migrateUpTo(sqlite, dir, 11);
    sqlite.exec(`
      insert into users (id, name, role, webauthn_id, created_at) values (2, 'Миша', 'member', 'friend', 1);
      insert into cards (id, user_id, korean, korean_key, meaning, examples, tags, speakable, source, created_at, updated_at, introduced_at, introduction)
        values (7, 1, '물', '물', 'вода', '[]', '[]', 1, 'app', 1, 1, 1, 'direct'),
               (8, 2, '불', '불', 'огонь', '[]', '[]', 1, 'app', 1, 1, 1, 'direct');
      insert into review_states values (7, 'meaning', 5, 1, 5, 0, 1, 0, 1, 0, 2, 1), (8, 'meaning', 5, 1, 5, 0, 1, 0, 1, 0, 2, 1);
      insert into review_log values ('r1', 7, 'meaning', 'good', 1, null), ('r2', 8, 'meaning', 'good', 1, null);
      insert into attempts (card_id, created_at, score, target_phones, heard_phones, syllables, errors_json) values (7, 1, 90, '[]', '[]', '[]', '[]');
      insert into card_audio values (7, '물', 'audio/mpeg', x'01', 1), (8, '불', 'audio/mpeg', x'02', 1);
      insert into speech_audio values ('물을 마셔요.', 'audio/mpeg', x'03', 1);
      insert into voice_audio values ('물', 'M1', 'audio/mpeg', x'04', 1);
      insert into settings (user_id, key, value) values (1, 'newPerDay', '5');
      insert into fsrs_settings (user_id, mode, desired_retention) values (1, 'meaning', 0.85), (2, 'meaning', 0.9);
      insert into phone_stats (user_id, phone, attempts, errors, last_seen) values (1, 'm', 3, 1, 1), (2, 'm', 1, 1, 1);
      insert into sound_drills (user_id, contrast, words, words_key, source, created_at) values (1, 'ㅂ/ㅍ', '[]', '불|풀', 'claude', 1);
    `);
    sqlite.close();

    const db = openDb(file);
    const n = (q: string) => (db.$client.prepare(`select count(*) n from ${q}`).get() as { n: number }).n;
    for (const table of ["cards", "fsrs_settings", "phone_stats", "sound_drills"]) expect(n(`${table} where user_id = 1`), table).toBe(0);
    for (const table of ["review_states", "review_log", "attempts", "card_audio"]) expect(n(`${table} where card_id = 7`), table).toBe(0);
    expect(n("settings where user_id = 1")).toBe(1);
    expect(n("users")).toBe(2);
    for (const table of ["cards", "fsrs_settings", "phone_stats"]) expect(n(`${table} where user_id = 2`), table).toBe(1);
    expect([n("review_states where card_id = 8"), n("review_log where card_id = 8"), n("card_audio where card_id = 8")]).toEqual([1, 1, 1]);
    const library = db.$client.prepare("select text, hex(data) data from speech_audio order by text").all();
    expect(library).toEqual([
      { text: "물", data: "01" },
      { text: "물을 마셔요.", data: "03" },
      { text: "불", data: "02" },
    ]);
    expect(n("voice_audio")).toBe(1);
    db.$client.close();
    rmSync(dir, { recursive: true });
  });
});
