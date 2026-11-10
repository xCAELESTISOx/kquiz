import type { RatingName } from "./types";

/** The options stay hidden this long, so the word is recalled before it can be recognised. */
export const REVEAL_MS = 3_000;

/** A right pick this long after the options showed was more search than recall. */
const SLOW_MS = 7_000;

/** A fair random number in [0, 1): from the system's generator where there is one. */
export function fairRandom(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
  return Math.random();
}

export function shuffled<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Where the right answer goes, dealt from a shuffled bag of the places: over every few tasks it
 * stands in each place once, and never twice running across two bags. Plain chance let it come up
 * first several times in a row, and the hand learns to reach there before the head recalls.
 */
export function slotDealer(random: () => number = fairRandom) {
  const bags = new Map<number, number[]>();
  let last: number | undefined;
  return (count: number): number => {
    if (count <= 1) return 0;
    let bag = bags.get(count);
    if (!bag?.length) {
      bag = shuffled([...Array(count).keys()], random);
      // The new bag's first place is the old one's last: swap it further in.
      if (bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
      bags.set(count, bag);
    }
    const slot = bag.pop()!;
    last = slot;
    return slot;
  };
}

const nextSlot = slotDealer();

/** The options in the order shown: the wrong ones shuffled, the right one in its dealt place. */
export function arranged<T>(right: T, wrong: T[], random: () => number = fairRandom, slot: (count: number) => number = nextSlot): T[] {
  const out = shuffled(wrong, random);
  out.splice(slot(wrong.length + 1), 0, right);
  return out;
}

/**
 * The rating a pick earns: wrong is again, right is good, or hard when it took long. Counted from
 * when the options showed, so the recall pause before them (waited out or skipped) costs nothing.
 */
export function choiceRating(correct: boolean, pickMs: number): RatingName {
  if (!correct) return "again";
  return pickMs > SLOW_MS ? "hard" : "good";
}
