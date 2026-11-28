import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { answerSchema, applyAnswers, grammarStats, listGrammar, startLearning } from "../grammar.js";

export const MAX_ANSWERS_PER_REQUEST = 200;

export function grammarRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Every construction with its sentences and where it stands; small enough to send whole.
  app.get("/", (c) => c.json({ points: listGrammar(db, c.get("user").id) }));

  app.get("/stats", (c) => c.json(grammarStats(db, c.get("user").id, now())));

  // Takes a construction from the pool onto the ladder.
  app.post("/:id/learning", (c) => {
    const id = z.coerce.number().int().positive().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_request" }, 400);
    const result = startLearning(db, c.get("user").id, id.data, now());
    if (!result.ok) return c.json({ error: result.reason }, result.reason === "not_found" ? 404 : 409);
    return c.json({ point: listGrammar(db, c.get("user").id, [id.data])[0] });
  });

  app.post("/answers", async (c) => {
    const body = z
      .object({ answers: z.array(answerSchema).min(1).max(MAX_ANSWERS_PER_REQUEST) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const userId = c.get("user").id;
    const result = applyAnswers(db, userId, body.data.answers);
    const ids = [...new Set(body.data.answers.map((a) => a.pointId))];
    return c.json({ ...result, points: listGrammar(db, userId, ids) });
  });

  return app;
}
