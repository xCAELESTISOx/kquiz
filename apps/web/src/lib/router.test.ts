import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./router";

describe("safeReturnTo", () => {
  it("allows same-origin paths only", () => {
    expect(safeReturnTo("/oauth/authorize?client_id=1")).toBe("/oauth/authorize?client_id=1");
    expect(safeReturnTo("/#/review")).toBe("/#/review");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo("/\t/evil.example")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });
});
