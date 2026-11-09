import { Hono } from "hono";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { LOG_ID, saveSessionLog, sessionLogSchema } from "../sessionLogs.js";

/** PUT /api/session-logs/:id: the app keeps a log of each session here for Claude to read (MCP get_session_log). */
export function sessionLogRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!LOG_ID.test(id)) return c.json({ error: "invalid_id" }, 400);
    const log = sessionLogSchema.safeParse(await c.req.json().catch(() => null));
    if (!log.success) return c.json({ error: "invalid_request", issues: log.error.issues }, 400);
    if (!saveSessionLog(db, c.get("user").id, id, log.data, now())) return c.json({ error: "conflict" }, 409);
    return c.json({ ok: true });
  });

  return app;
}
