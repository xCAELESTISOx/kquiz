import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { authRoutes, type WebAuthn } from "./auth/routes.js";
import { requireSession, type AuthVariables } from "./auth/sessions.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { cardRoutes } from "./routes/cards.js";
import { reviewRoutes } from "./routes/reviews.js";
import { scoreRoutes } from "./routes/score.js";
import { statsRoutes } from "./routes/stats.js";
import { httpScorer, type Scorer } from "./scorer.js";
import { requireCloudflare } from "./security/origin.js";
import { clientIp, rateLimit } from "./security/rateLimit.js";

export type AppDeps = {
  db: Db;
  config: Config;
  /** One-time code for binding the first passkey; undefined once one is bound. */
  setupCode?: string;
  webauthn?: WebAuthn;
  /** Pronunciation scorer; defaults to services/scorer at `config.scorerUrl`. */
  scorer?: Scorer;
  now?: () => Date;
};

// Generous for one person, low enough that a stolen session can't hammer the disk.
const API_LIMIT = { limit: 300, windowMs: 60_000 };

export function createApp({ db, config, setupCode, webauthn, scorer, now = () => new Date() }: AppDeps) {
  const app = new Hono<{ Variables: AuthVariables }>().basePath("/api");

  app.get("/health", (c) => c.json({ ok: true }));

  app.use(requireCloudflare(config.originSecret));
  app.use(secureHeaders());
  app.use(bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  // Browsers send Origin on every POST; a foreign one means a cross-site request.
  app.use(csrf({ origin: config.origin }));
  app.use(rateLimit({ ...API_LIMIT, key: (c) => clientIp(c), now: () => now().getTime() }));

  app.route("/auth", authRoutes({ db, config, setupCode, webauthn, now }));

  app.use("/cards/*", requireSession(db, config.secureCookies, now));
  app.use("/reviews/*", requireSession(db, config.secureCookies, now));
  app.use("/score", requireSession(db, config.secureCookies, now));
  app.use("/stats", requireSession(db, config.secureCookies, now));
  app.route("/cards", cardRoutes(db, now));
  app.route("/reviews", reviewRoutes(db, now));
  app.route("/stats", statsRoutes(db, now));
  app.route("/score", scoreRoutes(db, scorer ?? httpScorer(config.scorerUrl), now));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  return app;
}
