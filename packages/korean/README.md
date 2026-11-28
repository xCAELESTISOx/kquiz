# @kquiz/korean

Korean conjugation by rule, for the grammar mode. Nothing here stores finished forms: a form is
built from the dictionary form, the word's class and an ending written the way textbooks write
it.

```ts
import { build, mistakes, check, rule } from "@kquiz/korean";

build({ lemma: "듣다" }, "-아/어야 하다").form;                 // 들어야 합니다
build({ lemma: "살다" }, "-기로 하다", { tense: "past" }).form;  // 살기로 했습니다
build({ lemma: "연락하다" }, "못", { style: "polite", tense: "past" }).form; // 연락 못 했어요
mistakes({ lemma: "듣다" }, "-아/어야 하다");  // 듣어야 합니다 (irregular), 들아야 합니다 (harmony)
rule({ lemma: "듣다" });                        // ㄷ becomes ㄹ before a vowel: 듣다 → 들어요, 들은
```

- **Endings** (`inflect`): `아/어…`, `았/었…`, `(으)…`, `(스)ㅂ니다`, `는/(으)ㄴ…`, `ㄴ/는다…`, `다고…`,
  `요`, and plain ones (`고`, `지`, `기`, `게`, `는`, `네요`) that go straight on the stem.
- **Classes** (`conjClass`): ㄹ, 으, 하다 and 르 come from the spelling. ㅂ, ㄷ, ㅅ, ㅎ, 러 and
  우 can't be told from regular words (입다 / 돕다, 받다 / 듣다), so they come from a built-in
  list of common words, or from `cls` on the card for words with two readings (묻다 "ask" /
  "bury", 이르다 "early" / "arrive").
- **Constructions** (`build`): a prefix (`못`, `안`), the ending on the word, literal words
  (`수`, `이유`) and a final helper (`하다`, `있다`, `보다`, `전망이다`) that takes the sentence
  ending: 합니다체 present unless `final` says otherwise.
- **Answers** (`check`): contractions (보아/봐, 되어/돼) and a helper written together after
  -아/어 count as right; a wrong space comes back as `"spacing"`.
- **Pos**: `verb` by default; pass `adjective` for -는/(으)ㄴ and -ㄴ/는다, and `copula` for a
  noun with 이다 (학생이다 → 학생이에요, 의사예요).
