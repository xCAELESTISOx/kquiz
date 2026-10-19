import { Hono } from "hono";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { getSettings, settingsSchema, updateSettings } from "../settings.js";

export function settingsRoutes(db: Db) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", (c) => c.json(getSettings(db)));

  app.patch("/", async (c) => {
    const patch = settingsSchema.partial().safeParse(await c.req.json().catch(() => null));
    if (!patch.success) return c.json({ error: "invalid_request", issues: patch.error.issues }, 400);
    return c.json(updateSettings(db, patch.data));
  });

  return app;
}
