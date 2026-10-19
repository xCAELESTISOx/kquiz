import { describe, expect, it } from "vitest";
import { compareIntonation, intonationVerdict, pitch, RATE, wavSamples } from "./intonation";
import { encodeWav } from "./wav";

/** A voiced "vowel" whose pitch moves from `from` to `to` Hz: a few harmonics, so YIN and the cepstra both see speech. */
function glide(from: number, to: number, seconds: number, vowel = 1): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n + RATE * 0.2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = from + ((to - from) * i) / n;
    phase += (2 * Math.PI * f) / RATE;
    out[i + RATE * 0.1] = 0.4 * Math.sin(phase) + 0.2 * vowel * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
  }
  return out;
}

const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("pitch", () => {
  it("follows a steady tone", () => {
    const f0 = pitch(glide(200, 200, 0.5));
    const voiced = Array.from(f0).filter((v) => v > 0);
    expect(voiced.length).toBeGreaterThan(30);
    for (const v of voiced) expect(Math.abs(v - 200)).toBeLessThan(6);
  });

  it("finds no voice in silence", () => {
    expect(Array.from(pitch(new Float32Array(RATE))).every((v) => v === 0)).toBe(true);
  });
});

describe("compareIntonation", () => {
  // A rise then a fall, like a question tag; the learner's voice is an octave lower and slower.
  const reference = concat(glide(220, 330, 0.4), glide(330, 200, 0.4, 0.5));

  it("matches the same melody in another voice and tempo", () => {
    const yours = concat(glide(110, 165, 0.6), glide(165, 100, 0.6, 0.5));
    const result = compareIntonation(reference, yours);
    expect(result.similarity).toBeGreaterThan(0.7);
    expect(intonationVerdict(result).tone).toBe("ok");
  });

  it("tells an upside-down melody apart", () => {
    const yours = concat(glide(165, 110, 0.4), glide(110, 170, 0.4, 0.5));
    const result = compareIntonation(reference, yours);
    expect(result.similarity).toBeLessThan(0.4);
    expect(result.diverging.length).toBeGreaterThan(0);
    expect(intonationVerdict(result).tone).toBe("wrong");
  });

  it("asks again when there is no voice", () => {
    expect(intonationVerdict(compareIntonation(reference, new Float32Array(RATE))).tone).toBe("none");
  });
});

describe("wavSamples", () => {
  it("reads back what the recorder writes", () => {
    const { samples, rate } = wavSamples(encodeWav(new Float32Array([0, 0.5, -0.5]), 16000));
    expect(rate).toBe(16000);
    expect(Array.from(samples).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, -0.5]);
  });
});
