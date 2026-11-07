import { afterEach, describe, expect, it, vi } from "vitest";

// A stand-in <audio>: play() answers as `nextPlay` says.
class FakeAudio extends EventTarget {
  static plays: { src: string }[] = [];
  static nextPlay: (() => Promise<void>)[] = [];
  paused = true;
  preload = "";
  currentTime = 0;
  error: { code: number } | null = null;
  dataset: Record<string, string> = {};
  private attrs = new Map<string, string>();
  get src() {
    return this.attrs.get("src") ?? "";
  }
  set src(v: string) {
    this.attrs.set("src", v);
    this.error = null;
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  load() {}
  pause() {
    this.paused = true;
  }
  play() {
    this.paused = false;
    FakeAudio.plays.push({ src: this.src });
    return (FakeAudio.nextPlay.shift() ?? (() => Promise.resolve()))();
  }
}

const abort = () => Promise.reject(new DOMException("interrupted", "AbortError"));
const unsupported = () => Promise.reject(new DOMException("no source", "NotSupportedError"));

async function load(fetch: (url: string) => Promise<Response>) {
  vi.resetModules();
  FakeAudio.plays = [];
  FakeAudio.nextPlay = [];
  const system = vi.fn();
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", vi.fn(fetch));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:clip", revokeObjectURL: () => {} }));
  vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: system, getVoices: () => [] });
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    constructor(public text: string) {}
  });
  const speech = await import("./speech");
  return { system, ...speech };
}

const mp3 = () => new Response(new Blob(["mp3"]), { status: 200 });
const flush = () => new Promise((r) => setTimeout(r, 0));
const card = { id: 1, korean: "물" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadAudio", () => {
  it("tries again after a network error or a server restart", async () => {
    const responses = [() => Promise.reject(new TypeError("Load failed")), async () => new Response("", { status: 502 }), async () => mp3()];
    const { loadAudio } = await load(() => responses.shift()!());
    const blob = await loadAudio(card, [0, 0, 0]);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("reports a recording the server doesn't have", async () => {
    const { loadAudio } = await load(async () => new Response("", { status: 404 }));
    expect(await loadAudio(card, [0])).toBe("missing");
  });

  it("gives up after the last try", async () => {
    const { loadAudio } = await load(async () => new Response("", { status: 503 }));
    expect(await loadAudio(card, [0, 0])).toBe("broken");
  });
});

describe("speak", () => {
  it("plays the recording", async () => {
    const { speak, preloadSpeech, system } = await load(async () => mp3());
    preloadSpeech(card);
    await flush();
    speak(card);
    await flush();
    expect(FakeAudio.plays).toEqual([{ src: "blob:clip" }]);
    expect(system).not.toHaveBeenCalled();
  });

  it("stays silent when its play was cut short by the next one", async () => {
    const { speak, system } = await load(async () => mp3());
    FakeAudio.nextPlay.push(abort);
    speak(card);
    speak(card);
    await flush();
    await flush();
    expect(system).not.toHaveBeenCalled();
    // The clip isn't written off: a later tap plays the recording again.
    speak(card);
    await flush();
    expect(FakeAudio.plays).toHaveLength(3);
    expect(system).not.toHaveBeenCalled();
  });

  it("loads the recording again when the stream failed, instead of the phone's voice", async () => {
    const responses = [() => Promise.reject(new TypeError("Load failed")), async () => mp3()];
    const { speak, system } = await load(() => responses.shift()!());
    FakeAudio.nextPlay.push(unsupported);
    vi.useFakeTimers();
    speak(card);
    await vi.runAllTimersAsync();
    expect(system).not.toHaveBeenCalled();
    expect(FakeAudio.plays.at(-1)).toEqual({ src: "blob:clip" });
  });

  it("uses the phone's voice only when there is no recording", async () => {
    const { speak, preloadSpeech, system } = await load(async () => new Response("", { status: 404 }));
    preloadSpeech(card);
    await flush();
    speak(card);
    expect(system).toHaveBeenCalledTimes(1);
  });
});
