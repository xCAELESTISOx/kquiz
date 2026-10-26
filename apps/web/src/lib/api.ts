import { MockApi } from "./mock";
import type {
  AccessInfo,
  AddCardResult,
  AddCardsResult,
  AuthStatus,
  Card,
  CardFilter,
  CardList,
  CardPatch,
  CardSummary,
  FsrsStatus,
  GroupFilter,
  InviteStatus,
  Leech,
  NewCard,
  QueueItem,
  QueueMode,
  ReviewInput,
  ReviewMode,
  ReviewResult,
  ScoreResult,
  Settings,
  Stats,
  StatsOverview,
  UpdateCardResult,
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

/** Called right after a sign-in: nothing remembered from before may belong to this person. */
export function setCsrfToken(token: string | undefined) {
  csrfToken = token;
  lastAnswers.clear();
  forgetToday();
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

export async function request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const data = await send(method, path, opts);
  if (method === "GET") lastAnswers.set(path, data);
  return data;
}

async function send<T>(method: string, path: string, opts: RequestOptions<T>, retried = false): Promise<T> {
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
    // Whoever signs in next may be someone else.
    lastAnswers.clear();
    forgetToday();
    location.assign(loginUrl());
    throw new ApiError(401, "Нужно войти");
  }
  if (res.status === 403 && !retried && method !== "GET") {
    // The token may be stale after the session was renewed; fetch a fresh one once.
    csrfToken = undefined;
    return send(method, path, opts, true);
  }
  if (!res.ok && !opts.accept?.includes(res.status)) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 429) throw new ApiError(429, "Слишком много запросов, попробуй через минуту", data.error);
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.error);
  }
  return (await res.json()) as T;
}

// The last answer to each GET, so a screen opened again shows it at once and refreshes behind it.
// Memory only: signing in reloads the page, so one person's answers never reach another.
const lastAnswers = new Map<string, unknown>();

function lastAnswer<T>(path: string): T | undefined {
  return lastAnswers.get(path) as T | undefined;
}

type CardsQuery = { q?: string; tag?: string; status?: CardFilter; before?: number; limit?: number };

function cardsPath(query: CardsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return `/cards?${params}`;
}

const statsOverviewPath = () => `/stats?tz=${-new Date().getTimezoneOffset()}`;

/** Keeps the remembered card lists in step with a change made here; `null` means the card is gone. */
function rememberCard(id: number, card: Card | null) {
  for (const [path, answer] of lastAnswers) {
    if (path === `/cards/${id}`) {
      if (card) lastAnswers.set(path, { card });
      else lastAnswers.delete(path);
    }
    if (!path.startsWith("/cards?")) continue;
    const list = answer as CardList;
    if (!list.cards.some((c) => c.id === id)) continue;
    const stays = card && !(path.includes("status=queued") && !card.queued);
    lastAnswers.set(path, {
      ...list,
      cards: stays ? list.cards.map((c) => (c.id === id ? card : c)) : list.cards.filter((c) => c.id !== id),
    });
  }
}

/** What the server said last time, for drawing a screen before its fresh answer arrives. */
export const remembered = {
  cards: (query: CardsQuery) => lastAnswer<CardList>(cardsPath(query)),
  cardSummary: () => lastAnswer<CardSummary>("/cards/summary"),
  /** A card from its own screen or from any list it was seen in. */
  card(id: number): Card | undefined {
    const own = lastAnswer<{ card: Card }>(`/cards/${id}`);
    if (own) return own.card;
    for (const [path, answer] of lastAnswers)
      if (path.startsWith("/cards?")) {
        const found = (answer as CardList).cards.find((c) => c.id === id);
        if (found) return found;
      }
    return undefined;
  },
  settings: () => lastAnswer<Settings>("/settings"),
  stats: () => lastAnswer<Stats>("/reviews/stats"),
  statsOverview: () => lastAnswer<StatsOverview>(statsOverviewPath()),
  leeches: () => lastAnswer<{ items: Leech[] }>("/reviews/leeches"),
  fsrs: () => lastAnswer<FsrsStatus>("/reviews/fsrs"),
  authStatus: () => lastAnswer<AuthStatus>("/auth/status"),
};

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
  /** The owner's first passkey takes the setup code, a new person an invite code and their name. */
  registerOptions: (who: RegisterAs) => request<Record<string, unknown>>("POST", "/auth/register/options", { body: who }),
  registerVerify: (who: RegisterAs, response: unknown) =>
    request<{ ok: boolean; csrfToken?: string }>("POST", "/auth/register/verify", {
      body: { ...who, response, name: navigator.platform || "iPhone" },
    }),
  invite: (code: string) =>
    request<{ status: InviteStatus }>("GET", `/auth/invite?code=${encodeURIComponent(code)}`, { fallback: () => ({ status: "ok" }) }),
};

type RegisterAs = { setupCode: string } | { invite: string; userName: string };

/** The owner's access screen (apps/api routes/users.ts). */
export const access = {
  get: () => request<AccessInfo>("GET", "/users"),
  invite: () => request<{ url: string; expiresAt: string }>("POST", "/users/invites", { body: {} }),
  cancelInvites: () => request<{ cancelled: number }>("DELETE", "/users/invites"),
  disable: (id: number) => request<{ ok: true }>("POST", `/users/${id}/disable`, { body: {} }),
  enable: (id: number) => request<{ ok: true }>("POST", `/users/${id}/enable`, { body: {} }),
  remove: (id: number) => request<{ ok: true }>("DELETE", `/users/${id}`),
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

  cards: (query: CardsQuery = {}) => request<CardList>("GET", cardsPath(query), { fallback: (m) => m.cards(query) }),

  cardSummary: () => request<CardSummary>("GET", "/cards/summary", { fallback: (m) => m.cardSummary() }),

  card: (id: number) => request<{ card: Card }>("GET", `/cards/${id}`, { fallback: (m) => ({ card: m.card(id) }) }),

  async updateCard(id: number, patch: CardPatch): Promise<UpdateCardResult> {
    const res = await request<{ card: Card } | { error: "duplicate"; existingId: number }>("PATCH", `/cards/${id}`, {
      body: patch,
      accept: [409],
      fallback: (m) => ({ card: m.updateCard(id, patch) }),
    });
    if (!("card" in res)) return { status: "duplicate", existingId: res.existingId };
    rememberCard(id, res.card);
    return { status: "saved", card: res.card };
  },

  async deleteCard(id: number) {
    const res = await request<{ ok: true }>("DELETE", `/cards/${id}`, { fallback: (m) => m.deleteCard(id) });
    rememberCard(id, null);
    return res;
  },

  /** Takes a queued card into reviews now, outside the daily allowance. */
  async introduceCard(id: number) {
    const res = await request<{ card: Card }>("POST", `/cards/${id}/introduce`, { body: {}, fallback: (m) => ({ card: m.introduce(id) }) });
    rememberCard(id, res.card);
    return res;
  },

  settings: () => request<Settings>("GET", "/settings", { fallback: (m) => m.settings() }),

  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>("PATCH", "/settings", { body: patch, fallback: (m) => m.updateSettings(patch) }),

  /** A JSON file with every card, its schedule and the review history; opened as a download. */
  exportUrl: "/api/export",

  queue: (mode: QueueMode, limit = 50) => {
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

  /** Every card of a group, due or not, in random order. Queued cards in it are taken into reviews. */
  group: (mode: QueueMode, filter: GroupFilter) =>
    request<{ items: QueueItem[]; total: number }>("POST", "/reviews/group", {
      body: { mode, ...filter },
      fallback: (m) => m.group(mode, filter),
    }),

  review: (reviews: ReviewInput[]) =>
    request<{ results: ReviewResult[] }>("POST", "/reviews", { body: { reviews }, fallback: (m) => m.review(reviews) }),

  stats: () => request<Stats>("GET", "/reviews/stats", { fallback: (m) => m.stats() }),

  /** The statistics screen, with days in the phone's time zone. */
  statsOverview: () =>
    request<StatsOverview>("GET", statsOverviewPath(), { fallback: (m) => m.statsOverview() }),

  leeches: () => request<{ items: Leech[] }>("GET", "/reviews/leeches", { fallback: () => ({ items: [] }) }),

  fsrs: () => request<FsrsStatus>("GET", "/reviews/fsrs", { fallback: (m) => m.fsrs() }),

  setRetention: (mode: ReviewMode, desiredRetention: number) =>
    request<FsrsStatus>("PUT", "/reviews/fsrs", {
      body: { mode, desiredRetention },
      fallback: (m) => m.setRetention(mode, desiredRetention),
    }),

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

// The review screen keeps its latest rating here instead of sending it, so going back to that card
// can take it back. The next rating or leaving the screen sends it; if the app is closed first,
// the next start does (App.tsx).
const HELD_KEY = "kquiz.heldReview.v1";

function readHeld(): ReviewInput | undefined {
  try {
    return (JSON.parse(localStorage.getItem(HELD_KEY) ?? "null") as ReviewInput | null) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeHeld(input: ReviewInput | undefined) {
  try {
    if (input) localStorage.setItem(HELD_KEY, JSON.stringify(input));
    else localStorage.removeItem(HELD_KEY);
  } catch {
    // Storage blocked: an unheld rating is simply sent by the next release.
  }
}

/** Sends the previously held rating and holds this one until `releaseHeldReview` or the next hold. */
export async function holdReview(input: ReviewInput): Promise<void> {
  forgetToday();
  const previous = readHeld();
  writeHeld(input);
  if (readHeld()?.id !== input.id) return submitReview(input);
  if (previous) return submitReview(previous);
}

/** Drops the held rating, if it is this one; false when it has already gone. */
export function takeBackReview(id: string): boolean {
  if (readHeld()?.id !== id) return false;
  writeHeld(undefined);
  return true;
}

/** Sends the held rating, if any, with everything else waiting. */
export function releaseHeldReview(): Promise<void> {
  const held = readHeld();
  if (!held) return flushPendingReviews();
  writeHeld(undefined);
  return submitReview(held);
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
