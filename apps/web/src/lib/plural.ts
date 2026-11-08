/** "card" or "cards" for a count: 1 card, 2 cards. */
export function cardsWord(n: number): string {
  return n === 1 ? "card" : "cards";
}

/** With the number: 1 card, 5 cards. */
export function cardsCount(n: number): string {
  return `${n} ${cardsWord(n)}`;
}

/** "phrase" or "phrases" for a count. */
export function phrasesWord(n: number): string {
  return n === 1 ? "phrase" : "phrases";
}

/** "word" or "words" for a count. */
export function wordsWord(n: number): string {
  return n === 1 ? "word" : "words";
}
