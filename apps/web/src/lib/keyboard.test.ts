import { describe, expect, it } from "vitest";
import { keyboardInset } from "./keyboard";

describe("keyboardInset", () => {
  it("is the height the keyboard takes", () => {
    expect(keyboardInset(956, 570, 1)).toBe(386);
  });
  it("is nothing when the visual viewport is taller", () => {
    expect(keyboardInset(800, 820, 1)).toBe(0);
  });
  it("ignores a pinch-zoom", () => {
    expect(keyboardInset(956, 400, 2)).toBe(0);
  });
});
