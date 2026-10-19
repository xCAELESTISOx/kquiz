import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { createCards } from "../cardStore.js";
import { openDb } from "./client.js";
import { cards, reviewStates, users } from "./schema.js";
import { OWNER_ID } from "../users.js";

describe("migrations", () => {
  it("0004 gives cards made before listening mode a fresh listening schedule", () => {
    const db = openDb(":memory:");
    createCards(db, OWNER_ID, [{ korean: "물", meaning: "вода", tags: [] }], "app");
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
});

describe("migration 0008 (users)", () => {
  it("gives everything stored before it to the owner without losing a row", () => {
    // A database as it was at 0007, with a card, its schedule, history, audio and the rest.
    const dir = mkdtempSync(join(tmpdir(), "kquiz-0008-"));
    const old = join(dir, "migrations");
    mkdirSync(join(old, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 7);
    writeFileSync(join(old, "meta", "_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries) {
      copyFileSync(new URL(`../../drizzle/${e.tag}.sql`, import.meta.url), join(old, `${e.tag}.sql`));
    }
    const file = join(dir, "kquiz.db");
    const sqlite = new Database(file);
    migrate(drizzle(sqlite), { migrationsFolder: old });
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
    sqlite.close();

    const db = openDb(file);
    const count = (table: string) => (db.$client.prepare(`select count(*) n from ${table} where user_id = 1`).get() as { n: number }).n;
    for (const table of ["cards", "settings", "fsrs_settings", "phone_stats", "sound_drills", "auth_credentials", "auth_sessions", "oauth_grants"]) {
      expect(count(table), table).toBe(1);
    }
    const rows = (table: string) => (db.$client.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;
    expect([rows("review_states"), rows("review_log"), rows("attempts"), rows("card_audio")]).toEqual([1, 1, 1, 1]);
    expect(db.select().from(users).all()).toMatchObject([{ id: 1, role: "owner", webauthnId: "a3F1aXotb3duZXI" }]);
    expect(db.select({ id: cards.id }).from(cards).get()).toEqual({ id: 7 });
    db.$client.close();
    rmSync(dir, { recursive: true });
  });
});
