import { describe, expect, it } from "vitest";
import type { Final, Word } from "./conjugate.js";
import { build, check, mistakes, parse, rule } from "./grammar.js";

const b = (lemma: string, pattern: string, final: Final = {}, extra: Partial<Word> = {}) => build({ lemma, ...extra }, pattern, final).form;

describe("parse", () => {
  it("splits a construction into its parts", () => {
    expect(parse("-(으)ㄹ 수 있다")).toEqual({ prefix: [], ending: "-(으)ㄹ", rest: ["수"], aux: "있다" });
    expect(parse("못")).toEqual({ prefix: ["못"], ending: null, rest: [], aux: null });
    expect(parse("-는 이유")).toEqual({ prefix: [], ending: "-는", rest: ["이유"], aux: null });
  });
});

describe("build: the constructions from the grammar notes", () => {
  const polite: Final = { style: "polite" };
  const past: Final = { tense: "past" };
  const politePast: Final = { style: "polite", tense: "past" };
  it.each([
    ["앉다", "-(으)세요", {}, "앉으세요"],
    ["살다", "-(으)세요", {}, "사세요"],
    ["만들다", "-(으)세요", {}, "만드세요"],
    ["가다", "-아/어 주세요", {}, "가 주세요"],
    ["기다리다", "-고 있다", {}, "기다리고 있습니다"],
    ["찾다", "-지 못하고 있다", {}, "찾지 못하고 있습니다"],
    ["결제하다", "-(으)ㄹ 수 있다", polite, "결제할 수 있어요"],
    ["듣다", "-(으)ㄹ 수 있다", {}, "들을 수 있습니다"],
    ["돕다", "-(으)ㄹ 수 있다", {}, "도울 수 있습니다"],
    ["만들다", "-(으)ㄹ 수 있다", {}, "만들 수 있습니다"],
    ["가다", "-(으)ㄹ 수 없다", {}, "갈 수 없습니다"],
    ["내다", "-아/어야 하다", polite, "내야 해요"],
    ["고르다", "-아/어야 하다", {}, "골라야 합니다"],
    ["듣다", "-아/어야 하다", {}, "들어야 합니다"],
    ["돕다", "-아/어야 하다", {}, "도와야 합니다"],
    ["기다리다", "-아/어야 하다", {}, "기다려야 합니다"],
    ["가다", "-아/어야 되다", polite, "가야 돼요"],
    ["만들다", "-아/어야 하다", { style: "plain" }, "만들어야 한다"],
    ["연락하다", "못", politePast, "연락 못 했어요"],
    ["가다", "못", politePast, "못 갔어요"],
    ["따다", "-지 못하다", past, "따지 못했습니다"],
    ["입다", "-아/어 보다", past, "입어 봤습니다"],
    ["시작하다", "-아/어 보다", { ending: "(으)세요" }, "시작해 보세요"],
    ["살다", "-(으)ㄴ 지", {}, "산 지"],
    ["보다", "-(으)ㄴ", {}, "본"],
    ["공부하다", "-기 좋다", {}, "공부하기 좋습니다"],
    ["끝내다", "-아/어 버리다", past, "끝내 버렸습니다"],
    ["살다", "-기로 하다", past, "살기로 했습니다"],
    ["가다", "-는 이유", {}, "가는 이유"],
    ["가다", "-아/어서", {}, "가서"],
    ["가다", "안 -아/어도 되다", polite, "안 가도 돼요"],
    ["앉다", "-아/어 있다", polite, "앉아 있어요"],
    ["예쁘다", "-아/어지다", past, "예뻐졌습니다"],
    ["오르다", "-ㄴ/는다고 밝히다", { style: "plain", tense: "past" }, "오른다고 밝혔다"],
    ["늘다", "-는 것으로 보이다", {}, "느는 것으로 보입니다"],
    ["늘다", "-(으)ㄹ 전망이다", { style: "plain" }, "늘 전망이다"],
    ["오르다", "-(으)ㄹ 전망이다", {}, "오를 전망입니다"],
    ["오다", "-(으)ㄹ 때", {}, "올 때"],
    ["춥다", "-(으)ㄹ 때", {}, "추울 때"],
  ] as const)("%s %s → %s", (lemma, pattern, final, want) => {
    expect(b(lemma, pattern, final)).toBe(want);
  });

  it("uses the word class for adjectives and the copula", () => {
    expect(b("한국 사람이다", "-(으)ㄴ 줄 알다", { style: "polite", tense: "past" }, { pos: "copula" })).toBe("한국 사람인 줄 알았어요");
    expect(b("크다", "-게", {}, { pos: "adjective" })).toBe("크게");
    expect(b("비싸다", "-는/(으)ㄴ 줄 알다", past, { pos: "adjective" })).toBe("비싼 줄 알았습니다");
    expect(b("먹다", "-는/(으)ㄴ 줄 알다", past)).toBe("먹는 줄 알았습니다");
  });

  it("allows a helper verb written together after -아/어", () => {
    const built = build({ lemma: "즐기다" }, "-아/어 보다", { ending: "(으)세요" });
    expect(built.form).toBe("즐겨 보세요");
    expect(built.spacing).toContain("즐겨보세요");
    expect(build({ lemma: "가다" }, "-(으)ㄹ 수 있다").spacing).toEqual([]);
  });
});

describe("mistakes", () => {
  const forms = (lemma: string, pattern: string, extra: Partial<Word> = {}) =>
    Object.fromEntries(mistakes({ lemma, ...extra }, pattern).map((m) => [m.kind, m.form]));

  it("leaves out the irregular change, or adds one that isn't there", () => {
    expect(forms("듣다", "-아/어야 하다")).toMatchObject({ irregular: "듣어야 합니다", harmony: "들아야 합니다" });
    expect(forms("입다", "-아/어야 하다")).toMatchObject({ "not-irregular": "이워야 합니다", harmony: "입아야 합니다" });
    expect(forms("모르다", "-아/어서")).toMatchObject({ irregular: "모라서" });
    expect(forms("그렇다", "-아/어서", { pos: "adjective" })).toMatchObject({ irregular: "그렇어서" });
  });

  it("gets 으 and ㄹ wrong", () => {
    expect(forms("앉다", "-(으)세요")).toMatchObject({ eu: "앉세요" });
    expect(forms("살다", "-(으)세요")).toMatchObject({ l: "살으세요" });
    expect(forms("살다", "-는 이유")).toMatchObject({ l: "살는 이유" });
  });

  it("never offers a right spelling as a mistake", () => {
    for (const [lemma, pattern] of [["보다", "-아/어 보다"], ["가다", "-아/어서"], ["하다", "-아/어야 하다"]] as const) {
      const built = build({ lemma }, pattern);
      const ok = new Set([built.form, ...built.alts, ...built.spacing]);
      for (const m of mistakes({ lemma }, pattern)) expect(ok.has(m.form)).toBe(false);
    }
  });
});

describe("check", () => {
  const built = build({ lemma: "듣다" }, "-아/어야 하다");
  it("takes the right form, a contraction or loose punctuation", () => {
    expect(check("들어야 합니다", built)).toBe("right");
    expect(check(" 들어야  합니다. ", built)).toBe("right");
    expect(check("들어야합니다", built)).toBe("spacing");
    expect(check("듣어야 합니다", built)).toBe("wrong");
    expect(check("되어야 해요", build({ lemma: "되다" }, "-아/어야 하다", { style: "polite" }))).toBe("right");
  });
});

describe("rule", () => {
  it("explains the change with the word's own forms", () => {
    expect(rule({ lemma: "듣다" })).toBe("ㄷ becomes ㄹ before a vowel: 듣다 → 들어요, 들은");
    expect(rule({ lemma: "살다" })).toBe("ㄹ drops before ㄴ, ㅂ, ㅅ and takes no 으: 살다 → 사는, 삽니다, 사세요");
    expect(rule({ lemma: "먹다" })).toBeNull();
  });
});

describe("nouns", () => {
  const n = (lemma: string, pattern: string, final: Final = {}) => build({ lemma, pos: "noun" }, pattern, final).form;
  it("picks the particle by the last syllable", () => {
    expect(n("선거", "-을/를 앞두고")).toBe("선거를 앞두고");
    expect(n("발표", "-에 따르면")).toBe("발표에 따르면");
    expect(n("예산안", "-을/를 둘러싸고")).toBe("예산안을 둘러싸고");
    expect(n("1년", "만에")).toBe("1년 만에");
    expect(n("서울", "-(으)로")).toBe("서울로");
    expect(n("부산", "-(으)로")).toBe("부산으로");
    expect(n("학교", "-(으)로")).toBe("학교로");
    expect(n("한국 사람", "-(이)라고 하다", { style: "polite", tense: "past" })).toBe("한국 사람이라고 했어요");
  });
  it("offers the other one of the pair as a mistake", () => {
    expect(mistakes({ lemma: "선거", pos: "noun" }, "-을/를 앞두고")).toEqual([{ form: "선거을 앞두고", kind: "particle" }]);
    expect(mistakes({ lemma: "부산", pos: "noun" }, "-(으)로")).toEqual([{ form: "부산로", kind: "particle" }]);
  });
});
