import { describe, expect, it } from "vitest";
import type { QueueItem } from "./types";
import { forgetVoice, heard, pickVoice, voiceFor } from "./voices";

const item = (mode: QueueItem["mode"], voices?: string[]) =>
  ({ card: { id: 1, korean: "물" }, mode, due: "", state: 0, reps: 0, lapses: 0, voices }) as unknown as QueueItem;

describe("voices", () => {
  it("picks the default voice as often as each other one", () => {
    expect(pickVoice(["M1", "F3"], () => 0)).toBeUndefined();
    expect(pickVoice(["M1", "F3"], () => 0.4)).toBe("M1");
    expect(pickVoice(["M1", "F3"], () => 0.9)).toBe("F3");
    expect(pickVoice(undefined, () => 0.9)).toBeUndefined();
  });

  it("keeps a listening item's voice for replays until it comes back", () => {
    const listening = item("listening", ["M1", "F3", "M3"]);
    expect(voiceFor(listening, () => 0.3)).toBe("M1");
    expect(voiceFor(listening, () => 0.9)).toBe("M1");
    expect(heard(listening)).toEqual({ id: 1, korean: "물", voice: "M1" });
    forgetVoice(listening);
    expect(voiceFor(listening, () => 0.9)).toBe("M3");
  });

  it("leaves other modes and words without other voices in the default one", () => {
    expect(voiceFor(item("meaning", ["M1"]), () => 0.9)).toBeUndefined();
    expect(voiceFor(item("listening", []), () => 0.9)).toBeUndefined();
  });
});
