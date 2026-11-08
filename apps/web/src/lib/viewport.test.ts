import { describe, expect, it } from "vitest";
import { viewportGap } from "./viewport";

describe("viewportGap", () => {
  it("is the strip iOS leaves under a standalone app", () => {
    expect(viewportGap(440, 956, true, 897)).toBe(59);
  });
  it("is nothing once the layout reaches the screen bottom", () => {
    expect(viewportGap(440, 956, true, 956)).toBe(0);
  });
  it("ignores differences too big to be that strip", () => {
    expect(viewportGap(440, 956, true, 500)).toBe(0);
  });
  it("uses the short side in landscape", () => {
    expect(viewportGap(440, 956, false, 440)).toBe(0);
  });
});
