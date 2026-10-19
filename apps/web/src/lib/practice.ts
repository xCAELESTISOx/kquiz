// Shadowing and sound drills (apps/api/src/routes/practice.ts). Neither touches the review schedule.
import { useEffect, useState } from "react";
import { request } from "./api";
import { compareIntonation, loadReference, resampleTo, wavSamples, type IntonationComparison } from "./intonation";

export interface ShadowItem {
  cardId: number;
  word: string;
  meaning: string;
  ko: string;
  ru: string;
}

export interface Drill {
  id: number;
  contrast: string;
  words: { korean: string; meaning: string | null }[];
  correct: number;
  wrong: number;
  /** Every word has its reference audio. */
  ready: boolean;
}

// Dev without apps/api: a little to look at. The audio itself 404s there.
const DEMO_SHADOW: ShadowItem[] = [
  { cardId: 1, word: "안녕하세요", meaning: "здравствуйте", ko: "선생님, 안녕하세요!", ru: "Здравствуйте, учитель!" },
  { cardId: 2, word: "물", meaning: "вода", ko: "물 한 잔 주세요.", ru: "Стакан воды, пожалуйста." },
];
const DEMO_DRILLS: Drill[] = [
  {
    id: 1,
    contrast: "ㄱ/ㅋ/ㄲ",
    words: [
      { korean: "기다", meaning: "ползти" },
      { korean: "키다", meaning: null },
      { korean: "끼다", meaning: "надевать" },
    ],
    correct: 2,
    wrong: 3,
    ready: true,
  },
  {
    id: 2,
    contrast: "ㅓ/ㅗ",
    words: [
      { korean: "거리", meaning: "улица" },
      { korean: "고리", meaning: "кольцо" },
    ],
    correct: 4,
    wrong: 1,
    ready: true,
  },
];

export const practice = {
  shadowing: (limit = 10) =>
    request<{ items: ShadowItem[] }>("GET", `/practice/shadowing?limit=${limit}`, { fallback: () => ({ items: DEMO_SHADOW }) }),
  drills: () => request<{ drills: Drill[] }>("GET", "/practice/drills", { fallback: () => ({ drills: DEMO_DRILLS }) }),
  answer: (drillId: number, correct: boolean) =>
    request<{ ok: true }>("POST", `/practice/drills/${drillId}/answers`, { body: { correct }, fallback: () => ({ ok: true as const }) }),
  deleteDrill: (drillId: number) =>
    request<{ ok: true }>("DELETE", `/practice/drills/${drillId}`, { fallback: () => ({ ok: true as const }) }),
};

// ---- Sound drill rounds ----

const ROUND = 12;
// The hardest few sets come round again and again; the rest wait for the next round.
const FOCUS = 6;

export type Trial = { drill: Drill; target: number };

/** A round over the hardest drills, each trial a random word of its set. */
export function buildRound(drills: Drill[], random = Math.random): Trial[] {
  const pool = drills.filter((d) => d.ready).slice(0, FOCUS);
  if (!pool.length) return [];
  const trials: Trial[] = [];
  let last: Drill | undefined;
  for (let i = 0; i < ROUND; i++) {
    const choices = pool.length > 1 ? pool.filter((d) => d !== last) : pool;
    const drill = choices[Math.floor(random() * choices.length)]!;
    trials.push({ drill, target: Math.floor(random() * drill.words.length) });
    last = drill;
  }
  return trials;
}

export const textAudioUrl = (text: string) => `/api/practice/audio?text=${encodeURIComponent(text)}`;
export const cardAudioUrl = (cardId: number) => `/api/cards/${cardId}/audio`;

// ---- Playback ----

const players = new Map<string, HTMLAudioElement>();

function player(url: string): HTMLAudioElement {
  let audio = players.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = "auto";
    players.set(url, audio);
    // A short session touches a few dozen clips at most; drop the oldest beyond that.
    for (const key of players.keys()) {
      if (players.size <= 40) break;
      players.delete(key);
    }
  }
  return audio;
}

export function preload(url: string) {
  if (typeof Audio !== "undefined") player(url);
}

/** Plays a clip from the start; iOS only allows this inside a tap. Resolves false if it can't play. */
export function play(url: string): Promise<boolean> {
  if (typeof Audio === "undefined") return Promise.resolve(false);
  for (const other of players.values()) other.pause();
  const audio = player(url);
  audio.currentTime = 0;
  return audio.play().then(
    () => true,
    () => false,
  );
}

export function stopPlayback() {
  for (const audio of players.values()) audio.pause();
}

// ---- Intonation of a take ----

const references = new Map<string, Promise<Float32Array | undefined>>();

function reference(url: string) {
  let ref = references.get(url);
  if (!ref) {
    ref = loadReference(url).catch(() => undefined);
    references.set(url, ref);
    if (references.size > 20) references.delete(references.keys().next().value!);
  }
  return ref;
}

export type IntonationState =
  | { status: "working" }
  | { status: "done"; comparison: IntonationComparison }
  /** No reference audio yet, or it would not decode. */
  | { status: "unavailable" };

/** Compares the take with the reference once both are there; undefined while there is no take. */
export function useIntonation(referenceUrl: string, take: Uint8Array | undefined): IntonationState | undefined {
  const [state, setState] = useState<IntonationState>();
  useEffect(() => {
    if (!take) {
      setState(undefined);
      return;
    }
    let live = true;
    setState({ status: "working" });
    void reference(referenceUrl).then((ref) => {
      if (!live) return;
      if (!ref) return setState({ status: "unavailable" });
      // Let the spinner paint before the main thread is busy for a moment.
      setTimeout(() => {
        if (!live) return;
        const { samples, rate } = wavSamples(take);
        setState({ status: "done", comparison: compareIntonation(ref, resampleTo(samples, rate)) });
      }, 30);
    });
    return () => {
      live = false;
    };
  }, [referenceUrl, take]);
  return state;
}
