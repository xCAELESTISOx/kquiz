import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Opens the database file (or `:memory:`) and applies pending migrations. */
export function openDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // SQLite's lower() and LIKE fold only ASCII; search must also match "Яблоко" with "яблоко".
  sqlite.function("ulower", { deterministic: true }, (text: unknown) =>
    typeof text === "string" ? text.toLocaleLowerCase() : text,
  );
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
