/** Russian plural for "card" in the accusative: 1 карточку, 2 карточки, 5 карточек. */
export function cardsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "карточку";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "карточки";
  return "карточек";
}

/** Nominative: 1 карточка, 2 карточки, 5 карточек. */
export function cardsCount(n: number): string {
  const word = cardsWord(n);
  return `${n} ${word === "карточку" ? "карточка" : word}`;
}
