import { describe, expect, it } from "vitest";
import { downsample, encodeWav, rms } from "./wav";

describe("wav", () => {
  it("downsamples 48 kHz to 16 kHz by averaging", () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect(Array.from(downsample(input, 48_000)).map((x) => +x.toFixed(2))).toEqual([0.3, 1, -1]);
    expect(downsample(new Float32Array(44_100), 44_100)).toHaveLength(16_000);
    const same = new Float32Array(4);
    expect(downsample(same, 16_000)).toBe(same);
  });

  it("writes a 16-bit mono PCM header and clamps samples", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2]));
    const view = new DataView(wav.buffer);
    const text = (from: number, to: number) => String.fromCharCode(...wav.subarray(from, to));
    expect([text(0, 4), text(8, 12), text(12, 16), text(36, 40)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([
      1, 1, 16_000, 16,
    ]);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it("measures the level", () => {
    expect(rms(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });
});
