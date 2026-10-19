import { MockApi } from "./mock";
import type {
  AddCardResult,
  AddCardsResult,
  AuthStatus,
  Card,
  NewCard,
  QueueItem,
  ReviewInput,
  ReviewMode,
  ReviewResult,
  ScoreResult,
  Stats,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The API's `error` code, e.g. "busy" from /score. */
    readonly code?: string,
  ) {
    super(message);
  }
}

// In dev, when apps/api isn't running (or lacks an endpoint), calls fall back to a localStorage mock.
// Production builds never mock.
let mock: MockApi | undefined;
function getMock(): MockApi | undefined {
  if (!import.meta.env.DEV) return undefined;
  if (!mock) {
    mock = new MockApi(localStorage);
    console.info("[kquiz] api unavailable, using the local mock");
  }
  return mock;
}

// The session cookie is httpOnly; the CSRF token comes in JSON from /auth/status and the login responses.
let csrfToken: string | undefined;

export function setCsrfToken(token: string | undefined) {
  csrfToken = token;
}

export function loginUrl(returnTo = location.pathname + location.search + location.hash): string {
  return `/login?return_to=${encodeURIComponent(returnTo)}`;
}

interface RequestOptions<T> {
  /** JSON, or raw bytes sent with `contentType`. */
  body?: unknown;
  contentType?: string;
  /** Mock implementation for dev without a running api. */
  fallback?: (m: MockApi) => T;
  /** Statuses returned to the caller as data instead of thrown. */
  accept?: number[];
}

async function request<T>(method: string, path: string, opts: RequestOptions<T> = {}, retried = false): Promise<T> {
  const { body, fallback } = opts;
  // Any change (a rating, new cards) can change the queue.
  if (method !== "GET") recentQueues.clear();
  if (method !== "GET" && !csrfToken && !path.startsWith("/auth/")) {
    try {
      await authStatus();
    } catch {
      // The request below reports the real problem.
    }
  }
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    const raw = body instanceof Uint8Array;
    if (body !== undefined) headers["content-type"] = opts.contentType ?? "application/json";
    if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : raw ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
    });
  } catch (error) {
    const m = fallback && getMock();
    if (m) return fallback(m);
    throw error;
  }
  if (res.status === 404 || res.status === 502 || res.status === 504) {
    const m = fallback && getMock();
    if (m) return fallback(m);
  }
  if (res.status === 401 && !path.startsWith("/auth/")) {
    location.assign(loginUrl());
    throw new ApiError(401, "Нужно войти");
  }
  if (res.status === 403 && !retried && method !== "GET") {
    // The token may be stale after the session was renewed; fetch a fresh one once.
    csrfToken = undefined;
    return request(method, path, opts, true);
  }
  if (!res.ok && !opts.accept?.includes(res.status)) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 429) throw new ApiError(429, "Слишком много запросов, попробуй через минуту", data.error);
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.error);
  }
  return (await res.json()) as T;
}

export async function authStatus(): Promise<AuthStatus> {
  const status = await request<AuthStatus>("GET", "/auth/status", {
    fallback: () => ({ authenticated: true, setupRequired: false, csrfToken: "mock" }),
  });
  csrfToken = status.csrfToken;
  return status;
}

export const auth = {
  status: authStatus,
  loginOptions: () => request<Record<string, unknown>>("POST", "/auth/login/options", { body: {} }),
  loginVerify: (response: unknown) =>
    request<{ ok: boolean; csrfToken?: string }>("POST", "/auth/login/verify", { body: { response } }),
  registerOptions: (setupCode: string) =>
    request<Record<string, unknown>>("POST", "/auth/register/options", { body: { setupCode } }),
  registerVerify: (setupCode: string, response: unknown) =>
    request<{ ok: boolean; csrfToken?: string }>("POST", "/auth/register/verify", {
      body: { setupCode, response, name: navigator.platform || "iPhone" },
    }),
};

const QUEUE_TTL = 60_000;
const recentQueues = new Map<string, { at: number; promise: Promise<{ items: QueueItem[] }> }>();

export const api = {
  async addCard(card: NewCard): Promise<AddCardResult> {
    const res = await request<{ card: Card } | { error: "duplicate"; existingId: number }>("POST", "/cards", {
      body: card,
      accept: [409],
      fallback: (m) => {
        const r = m.addCard(card);
        return r.status === "created" ? { card: r.card } : { error: "duplicate" as const, existingId: r.existingId };
      },
    });
    return "card" in res ? { status: "created", card: res.card } : { status: "duplicate", existingId: res.existingId };
  },

  addCards: (cards: NewCard[]) =>
    request<AddCardsResult>("POST", "/cards/bulk", { body: { cards }, fallback: (m) => m.addCards(cards) }),

  queue: (mode: ReviewMode, limit = 50) => {
    // The Today screen asks for the queue, and the review screen opened from it gets the same answer
    // instead of another round trip.
    const key = `${mode}:${limit}`;
    const hit = recentQueues.get(key);
    if (hit && performance.now() - hit.at < QUEUE_TTL) return hit.promise;
    const promise = request<{ items: QueueItem[] }>("GET", `/reviews/queue?mode=${mode}&limit=${limit}`, {
      fallback: (m) => ({ items: m.queue(mode, limit) }),
    });
    recentQueues.set(key, { at: performance.now(), promise });
    promise.catch(() => recentQueues.get(key)?.promise === promise && recentQueues.delete(key));
    return promise;
  },

  review: (reviews: ReviewInput[]) =>
    request<{ results: ReviewResult[] }>("POST", "/reviews", { body: { reviews }, fallback: (m) => m.review(reviews) }),

  stats: () => request<Stats>("GET", "/reviews/stats", { fallback: (m) => m.stats() }),

  /** Scores a recording against the card. It is not a review: the rating is sent separately. */
  score: (cardId: number, wav: Uint8Array<ArrayBuffer>) =>
    request<ScoreResult>("POST", `/score?cardId=${cardId}`, {
      body: wav,
      contentType: "audio/wav",
      fallback: (m) => m.score(cardId),
    }),
};

// The Today screen's last numbers, shown at once on the next launch while fresh ones load.
const TODAY_KEY = "kquiz.today.v1";

export interface TodaySnapshot {
  stats: Stats;
  preview: QueueItem[];
}

export function lastToday(): TodaySnapshot | undefined {
  try {
    return (JSON.parse(localStorage.getItem(TODAY_KEY) ?? "null") as TodaySnapshot | null) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberToday(snapshot: TodaySnapshot) {
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify(snapshot));
  } catch {
    // Only a speed-up.
  }
}

/** After a rating the saved numbers are wrong, so Today waits for the server instead. */
function forgetToday() {
  try {
    localStorage.removeItem(TODAY_KEY);
  } catch {
    // Nothing saved, nothing to forget.
  }
}

// Every review goes through this local queue and is sent in batches, so ratings made offline
// or while the server is down are not lost. Each has its own UUID, so a resend is harmless.
const PENDING_KEY = "kquiz.pendingReviews.v1";
const BATCH = 200;

function readPending(): ReviewInput[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as ReviewInput[];
  } catch {
    return [];
  }
}

function writePending(items: ReviewInput[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the review is lost, nothing else to do.
  }
}

export function pendingReviewCount(): number {
  return readPending().length;
}

export async function submitReview(input: ReviewInput): Promise<void> {
  forgetToday();
  writePending([...readPending(), input]);
  // A flush already in flight may have read the queue before this review landed.
  if (flushing) await flushing;
  return flushPendingReviews();
}

let flushing: Promise<void> | undefined;
export function flushPendingReviews(): Promise<void> {
  flushing ??= sendPending().finally(() => {
    flushing = undefined;
  });
  return flushing;
}

async function sendPending(): Promise<void> {
  for (let batch = readPending().slice(0, BATCH); batch.length; batch = readPending().slice(0, BATCH)) {
    try {
      await api.review(batch);
    } catch (error) {
      // Offline, server trouble, auth or rate limit: keep everything and retry later.
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 0 || status >= 500 || status === 401 || status === 403 || status === 429) return;
      // Any other 4xx means the batch itself is malformed; resending it would never succeed.
      console.error("[kquiz] reviews rejected", error);
    }
    const sent = new Set(batch.map((r) => r.id));
    writePending(readPending().filter((r) => !sent.has(r.id)));
  }
}
