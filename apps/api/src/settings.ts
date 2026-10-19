import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const settingsSchema = z.object({
  /** Cards from the new-card queue that enter reviews each day. */
  newPerDay: z.number().int().min(0).max(200),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = { newPerDay: 15 };

export function getSettings(db: Pick<Db, "select">, userId: number): Settings {
  const result = { ...defaultSettings };
  for (const row of db.select().from(settings).where(eq(settings.userId, userId)).all()) {
    const field = settingsSchema.shape[row.key as keyof Settings];
    const parsed = field?.safeParse(row.value);
    if (parsed?.success) Object.assign(result, { [row.key]: parsed.data });
  }
  return result;
}

export function updateSettings(db: Db, userId: number, patch: Partial<Settings>): Settings {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      tx.insert(settings)
        .values({ userId, key, value })
        .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value } })
        .run();
    }
  });
  return getSettings(db, userId);
}
