import type { CoachLetter, ISODate } from "./types";

export const letterFor = (letters: CoachLetter[] | undefined, week: ISODate): CoachLetter | undefined => letters?.find((l) => l.week === week);

/** The letter list after adding one: one per week, newest last, the last 12 kept. */
export const withLetter = (letters: CoachLetter[] | undefined, letter: CoachLetter): CoachLetter[] =>
  [...(letters ?? []).filter((l) => l.week !== letter.week), letter].sort((a, b) => a.week.localeCompare(b.week)).slice(-12);
