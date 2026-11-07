import { describe, expect, it } from "vitest";
import { groupHash, parseHash, safeReturnTo } from "./router";

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
    expect(parseHash("#/learn/12")).toEqual({ route: "learn", param: "12" });
    expect(parseHash("#/learn/x")).toEqual({ route: "today" });
    expect(parseHash("#/nope")).toEqual({ route: "today" });
    expect(parseHash("#/access")).toEqual({ route: "access" });
    expect(parseHash("#/invite/Ab-9_x")).toEqual({ route: "invite", param: "Ab-9_x" });
    expect(parseHash("#/invite")).toEqual({ route: "today" });
  });

  it("reads a word family on the cards screen and in a group", () => {
    expect(parseHash("#/cards?root=" + encodeURIComponent("學"))).toEqual({ route: "cards", param: undefined, root: "學" });
    expect(parseHash("#/cards/queued?root=學")).toEqual({ route: "cards", param: "queued", root: "學" });
    expect(parseHash(groupHash("review", { root: "學" }))).toEqual({ route: "review", group: { root: "學" } });
  });

  it("reads a chosen group of cards to review", () => {
    const hash = groupHash("speech", { q: "물 병", tag: "еда" });
    expect(parseHash(hash)).toEqual({ route: "speech", group: { q: "물 병", tag: "еда" } });
    expect(parseHash("#/listen?status=queued&status2=x")).toEqual({ route: "listen", group: { status: "queued" } });
    expect(parseHash("#/review?")).toEqual({ route: "review", group: {} });
    expect(parseHash(groupHash("mix", { tag: "еда" }))).toEqual({ route: "mix", group: { tag: "еда" } });
    expect(parseHash("#/mix")).toEqual({ route: "mix" });
    expect(parseHash(groupHash("mix", { tag: "еда" }, { all: true }))).toEqual({ route: "mix", group: { tag: "еда" }, all: true });
    expect(parseHash(groupHash("learn", { q: "먹" }))).toEqual({ route: "learn", group: { q: "먹" } });
    expect(parseHash("#/session")).toEqual({ route: "session" });
    expect(parseHash("#/cards/queued?x=1")).toEqual({ route: "cards", param: "queued" });
  });
});
