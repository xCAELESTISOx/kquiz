import { MockApi } from "./mock";
import type { AddCardsResult, Card, CardSource, NewCard, ReviewInput, ReviewMode, Stats } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// In dev, endpoints apps/api doesn't have yet (404) or a stopped api fall back to a localStorage mock.
// Production builds never mock.
let mock: MockApi | undefined;
function getMock(): MockApi | undefined {
  if (!import.meta.env.DEV) return undefined;
  if (!mock) {
    mock = new MockApi(localStorage);
    console.info("[kquiz] api endpoint missing, using the local mock");
  }
  return mock;
}

function csrfToken(): string | undefined {
  return document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)?.[1];
}

async function request<T>(method: string, path: string, body: unknown, fallback: (m: MockApi) => T): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const csrf = method === "GET" ? undefined : csrfToken();
    if (csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const m = getMock();
    if (m) return fallback(m);
    throw error;
  }
  if (res.status === 404 || res.status === 502 || res.status === 504) {
    const m = getMock();
    if (m) return fallback(m);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  addCards: (cards: NewCard[], source: CardSource) =>
    request<AddCardsResult>("POST", "/cards", { cards, source }, (m) => m.addCards(cards, source)),

  queue: (mode: ReviewMode, limit = 50) =>
    request<{ cards: Card[] }>("GET", `/reviews/queue?mode=${mode}&limit=${limit}`, undefined, (m) => ({
      cards: m.queue(mode, limit),
    })),

  review: (input: ReviewInput) =>
    request<{ ok: true; due: string }>("POST", "/reviews", input, (m) => m.review(input)),

  stats: () => request<Stats>("GET", "/stats", undefined, (m) => m.stats()),
};

// Reviews that failed to send (offline, server down) wait here and are resent later.
// Each has its own UUID, so a resend the server already saw is harmless.
const PENDING_KEY = "kquiz.pendingReviews.v1";

function readPending(): ReviewInput[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as ReviewInput[];
  } catch {
    return [];
  }
}

function writePending(items: ReviewInput[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

export function pendingReviewCount(): number {
  return readPending().length;
}

export async function submitReview(input: ReviewInput): Promise<void> {
  try {
    await api.review(input);
  } catch (error) {
    // A 4xx means the server rejected it for good; resending would not help.
    if (error instanceof ApiError && error.status < 500 && error.status !== 401) throw error;
    writePending([...readPending(), input]);
  }
}

let flushing = false;
export async function flushPendingReviews(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of readPending()) {
      try {
        await api.review(item);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) break;
      }
      writePending(readPending().filter((p) => p.id !== item.id));
    }
  } finally {
    flushing = false;
  }
}
