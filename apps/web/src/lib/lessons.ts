// Lessons of new words (apps/api newCards.ts): the cards added on one day, learned in order.

/** "7 ноября", or "7 ноября 2025" for another year: how a lesson is named. */
export function lessonDate(day: string, now = new Date()): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", ...(y !== now.getFullYear() && { year: "numeric" }) }).format(date);
}
