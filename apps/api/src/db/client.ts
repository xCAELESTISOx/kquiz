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
  sqlite.pragma("busy_timeout = 5000");
  // SQLite's lower() and LIKE fold only ASCII; search must also match "Яблоко" with "яблоко".
  sqlite.function("ulower", { deterministic: true }, (text: unknown) =>
    typeof text === "string" ? text.toLocaleLowerCase() : text,
  );
  const db = drizzle(sqlite, { schema });
  // Off while migrating: rebuilding a table (0008) drops the old one, and with foreign keys on
  // that would cascade into every row that points at it. The pragma can't change inside the
  // migration's transaction, so it is set around it, and the result is checked before going on.
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder });
  const broken = sqlite.pragma("foreign_key_check") as unknown[];
  if (broken.length) throw new Error(`migrations left ${broken.length} broken foreign keys`);
  sqlite.pragma("foreign_keys = ON");
  return db;
}
