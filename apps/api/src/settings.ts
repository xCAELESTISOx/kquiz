import { z } from "zod";
import type { Db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const settingsSchema = z.object({
  /** Cards from the new-card queue that enter reviews each day. */
  newPerDay: z.number().int().min(0).max(200),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = { newPerDay: 15 };

export function getSettings(db: Db): Settings {
  const result = { ...defaultSettings };
  for (const row of db.select().from(settings).all()) {
    const field = settingsSchema.shape[row.key as keyof Settings];
    const parsed = field?.safeParse(row.value);
    if (parsed?.success) Object.assign(result, { [row.key]: parsed.data });
  }
  return result;
}

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    }
  });
  return getSettings(db);
}
