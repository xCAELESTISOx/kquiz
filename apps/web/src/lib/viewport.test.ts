import { describe, expect, it } from "vitest";
import { standaloneHeight } from "./viewport";

describe("standaloneHeight", () => {
  it("is the long side in portrait", () => {
    expect(standaloneHeight(440, 956, true)).toBe(956);
  });
  it("is the short side in landscape", () => {
    expect(standaloneHeight(440, 956, false)).toBe(440);
  });
});
