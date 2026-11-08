import { z } from "zod";

const envSchema = z.object({
  DATABASE_PATH: z.string().default("./data/kquiz.db"),
  // Public origin of the app, e.g. https://kquiz.example.com. Passkeys are bound to it.
  ORIGIN: z.url().default("http://localhost:5173"),
  RP_NAME: z.string().default("KQuiz"),
  // Secret header value the reverse proxy in front of the API adds to every request (deploy/Caddyfile;
  // a CDN such as Cloudflare can do the same). When set, requests without it are rejected.
  ORIGIN_SECRET: z.string().min(32).optional(),
  // One-time code for binding the first passkey. Generated at startup when unset.
  SETUP_CODE: z.string().min(16).optional(),
  // services/scorer, reachable only from this host.
  SCORER_URL: z.url().default("http://127.0.0.1:8788"),
  // The owner's time zone: "today" and the daily new-card allowance start at its midnight.
  TIME_ZONE: z
    .string()
    .default("Asia/Seoul")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "unknown time zone"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = {
  databasePath: string;
  origin: string;
  rpId: string;
  rpName: string;
  originSecret: string | undefined;
  setupCode: string | undefined;
  scorerUrl: string;
  timeZone: string;
  // Secure cookies need HTTPS; off only for local http development.
  secureCookies: boolean;
  production: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  const origin = new URL(parsed.ORIGIN);
  const production = parsed.NODE_ENV === "production";
  if (production && origin.protocol !== "https:") throw new Error("ORIGIN must be https in production");
  if (production && !parsed.ORIGIN_SECRET) throw new Error("ORIGIN_SECRET is required in production");
  return {
    databasePath: parsed.DATABASE_PATH,
    origin: origin.origin,
    rpId: origin.hostname,
    rpName: parsed.RP_NAME,
    originSecret: parsed.ORIGIN_SECRET,
    setupCode: parsed.SETUP_CODE,
    scorerUrl: parsed.SCORER_URL.replace(/\/+$/, ""),
    timeZone: parsed.TIME_ZONE,
    secureCookies: origin.protocol === "https:",
    production,
  };
}
