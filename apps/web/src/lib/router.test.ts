import { describe, expect, it } from "vitest";
import { parseHash, safeReturnTo } from "./router";

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

describe("parseHash", () => {
  it("reads screens, card ids and list filters", () => {
    expect(parseHash("")).toEqual({ route: "today" });
    expect(parseHash("#/review")).toEqual({ route: "review" });
    expect(parseHash("#/cards")).toEqual({ route: "cards", param: undefined });
    expect(parseHash("#/cards/queued")).toEqual({ route: "cards", param: "queued" });
    expect(parseHash("#/cards/12")).toEqual({ route: "card", param: "12" });
    expect(parseHash("#/nope")).toEqual({ route: "today" });
  });
});
