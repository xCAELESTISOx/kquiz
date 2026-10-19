// SQLite implementations of the stores the MCP server needs; `index.ts` passes them to createMcpApp.
import { desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { readSession } from "../auth/sessions.js";
import { createCards, toCardDto, updateCard, type CardDto, type CardSource } from "../cardStore.js";
import { koreanKey, normalizeKorean, type CardPatch, type NewCard } from "../cards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { cards, oauthClients, oauthCodes, oauthGrants, phoneStats, reviewLog } from "../db/schema.js";
import type { OwnerAuth } from "../mcp/app.js";
import type { OAuthStore } from "../mcp/oauth-store.js";
import type { CardStore } from "../mcp/store.js";
import { getStats } from "../reviewStore.js";
import { statsOverview } from "../statsStore.js";

export type StoredCard = NewCard & {
  id: string;
  speakable: boolean;
  source: CardSource;
  createdAt: string;
  updatedAt: string;
};

function toStoredCard(card: CardDto): StoredCard {
  const optional = (value: string | null) => value ?? undefined;
  return {
    id: String(card.id),
    korean: card.korean,
    meaning: card.meaning,
    pronunciation: optional(card.pronunciation),
    romanization: optional(card.romanization),
    examples: card.examples,
    notes: optional(card.notes),
    tags: card.tags,
    speakable: card.speakable,
    source: card.source,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

/** Consecutive days with at least one review, ending today or yesterday (UTC). */
export function streakDays(db: Db, now: Date): number {
  const days = db
    .selectDistinct({ day: sql<number>`cast(${reviewLog.reviewedAt} / 86400000 as integer)` })
    .from(reviewLog)
    .orderBy(desc(sql`1`))
    .limit(3660)
    .all()
    .map((row) => row.day);
  const today = Math.floor(now.getTime() / 86_400_000);
  let expected = days[0] === today ? today : today - 1;
  let streak = 0;
  for (const day of days) {
    if (day > expected) continue;
    if (day !== expected) break;
    streak += 1;
    expected -= 1;
  }
  return streak;
}

export class SqliteCardStore implements CardStore {
  constructor(private readonly db: Db) {}

  async findByKorean(korean: string[]): Promise<Map<string, StoredCard>> {
    const keys = new Map(korean.map((text) => [koreanKey(text), normalizeKorean(text)]));
    const found = new Map<string, StoredCard>();
    if (keys.size === 0) return found;
    const rows = this.db.select().from(cards).where(inArray(cards.koreanKey, [...keys.keys()])).all();
    for (const row of rows) found.set(keys.get(row.koreanKey)!, toStoredCard(toCardDto(row)));
    return found;
  }

  async insert(input: NewCard[], source: CardSource): Promise<StoredCard[]> {
    return createCards(this.db, input, source).created.map(toStoredCard);
  }

  async find({ text, tag, limit }: { text?: string; tag?: string; limit: number }): Promise<StoredCard[]> {
    const conditions = [];
    if (text) {
      const pattern = `%${text.toLocaleLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(
        sql`(ulower(${cards.korean}) like ${pattern} escape '\\' or ulower(${cards.meaning}) like ${pattern} escape '\\'
          or ulower(coalesce(${cards.pronunciation}, '')) like ${pattern} escape '\\'
          or ulower(coalesce(${cards.romanization}, '')) like ${pattern} escape '\\')`,
      );
    }
    if (tag) conditions.push(sql`exists (select 1 from json_each(${cards.tags}) where value = ${tag})`);
    const where = conditions.length ? sql.join(conditions, sql` and `) : undefined;
    return this.db
      .select()
      .from(cards)
      .where(where)
      .orderBy(desc(cards.id))
      .limit(Math.min(Math.max(limit, 1), 200))
      .all()
      .map((row) => toStoredCard(toCardDto(row)));
  }

  async update(id: string, patch: Partial<NewCard> & { speakable?: boolean }): Promise<StoredCard | null> {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
    const result = updateCard(this.db, numericId, patch as CardPatch);
    if ("card" in result) return toStoredCard(result.card);
    if (result.error === "duplicate") throw new Error(`Card ${result.existingId} already has this Korean text`);
    return null;
  }

  async stats(now: Date) {
    const stats = getStats(this.db, now);
    const overview = statsOverview(this.db, now);
    const dueNext7Days: Record<string, number> = {};
    for (const { due } of overview.forecast.slice(0, 7)) {
      for (const [mode, n] of Object.entries(due)) dueNext7Days[mode] = (dueNext7Days[mode] ?? 0) + n;
    }
    const retention30d = Object.fromEntries(
      Object.entries(overview.retention).map(([mode, r]) => [mode, r.reviews ? Math.round((r.recalled / r.reviews) * 100) / 100 : null]),
    );
    return {
      cards: stats.cards,
      dueMeaning: stats.due.meaning,
      dueSpeech: stats.due.speech,
      streakDays: streakDays(this.db, now),
      dueNext7Days,
      retention30d,
    };
  }

  async weakSounds(limit: number) {
    return this.db
      .select({ phone: phoneStats.phone, attempts: phoneStats.attempts, errors: phoneStats.errors })
      .from(phoneStats)
      .where(sql`${phoneStats.attempts} > 0`)
      .orderBy(desc(sql`cast(${phoneStats.errors} as real) / ${phoneStats.attempts}`), desc(phoneStats.attempts))
      .limit(limit)
      .all()
      .map((row) => ({ ...row, errorRate: row.errors / row.attempts }));
  }
}

type OAuthClient = typeof oauthClients.$inferSelect;
type AuthCode = typeof oauthCodes.$inferSelect;
type Grant = typeof oauthGrants.$inferSelect;

const withoutNulls = <T extends object>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as { [K in keyof T]: Exclude<T[K], null> };

export class SqliteOAuthStore implements OAuthStore {
  constructor(private readonly db: Db) {}

  async countClients() {
    return this.db.$count(oauthClients);
  }

  async evictOldestUnapprovedClient() {
    const oldest = this.db
      .select({ clientId: oauthClients.clientId })
      .from(oauthClients)
      .where(sql`${oauthClients.approvedAt} is null`)
      .orderBy(oauthClients.createdAt)
      .limit(1)
      .get();
    if (!oldest) return false;
    this.db.delete(oauthClients).where(eq(oauthClients.clientId, oldest.clientId)).run();
    return true;
  }

  async saveClient(client: { clientId: string; secretHash?: string; name: string; redirectUris: string[]; createdAt: number; approvedAt?: number }) {
    const row = { ...client, secretHash: client.secretHash ?? null, approvedAt: client.approvedAt ?? null };
    this.db.insert(oauthClients).values(row).onConflictDoUpdate({ target: oauthClients.clientId, set: row }).run();
  }

  async getClient(clientId: string) {
    const row = this.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
    return row ? withoutNulls<OAuthClient>(row) : null;
  }

  async markClientApproved(clientId: string, at: number) {
    this.db
      .update(oauthClients)
      .set({ approvedAt: sql`coalesce(${oauthClients.approvedAt}, ${at})` })
      .where(eq(oauthClients.clientId, clientId))
      .run();
  }

  async saveCode(code: AuthCode) {
    this.db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, Date.now())).run();
    this.db.insert(oauthCodes).values(code).run();
  }

  async takeCode(codeHash: string) {
    return this.db.delete(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).returning().get() ?? null;
  }

  async saveGrant(grant: Grant) {
    this.db.insert(oauthGrants).values(grant).onConflictDoUpdate({ target: oauthGrants.id, set: grant }).run();
  }

  async findGrantByAccess(accessHash: string) {
    return this.db.select().from(oauthGrants).where(eq(oauthGrants.accessHash, accessHash)).get() ?? null;
  }

  async findGrantByRefresh(refreshHash: string) {
    return (
      this.db
        .select()
        .from(oauthGrants)
        .where(
          sql`${oauthGrants.refreshHash} = ${refreshHash}
            or exists (select 1 from json_each(${oauthGrants.usedRefreshHashes}) where value = ${refreshHash})`,
        )
        .get() ?? null
    );
  }

  async touchGrant(id: string, at: number) {
    this.db.update(oauthGrants).set({ lastUsedAt: at }).where(eq(oauthGrants.id, id)).run();
  }

  async listGrants() {
    return this.db.select().from(oauthGrants).orderBy(desc(oauthGrants.lastUsedAt)).all();
  }

  async deleteGrant(id: string) {
    this.db.delete(oauthGrants).where(eq(oauthGrants.id, id)).run();
  }
}

/**
 * The owner's passkey session for the OAuth consent page. `authenticatedAt` is when the
 * session was created, i.e. the moment of the passkey assertion.
 */
export function ownerAuth(db: Db, config: Config, now: () => Date = () => new Date()): OwnerAuth {
  return {
    async session(c: Context) {
      const session = readSession(c, db, config.secureCookies, now());
      return session ? { authenticatedAt: session.createdAt } : null;
    },
    // The web app's /login always asks for a passkey, then goes to return_to (same-origin paths only).
    loginUrl(returnTo: string) {
      return `/login?fresh=1&return_to=${encodeURIComponent(returnTo)}`;
    },
  };
}
