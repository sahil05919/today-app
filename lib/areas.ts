import { bestArea } from "./dictionary";
import type { Area } from "./types";

/**
 * Offline guess at which area a task belongs to, from its words (English, Hinglish, Devanagari).
 * Only suggests areas you actually have; anything unclear goes to "Others" (if you keep that area).
 * See lib/dictionary.ts for the word lists.
 */
export function inferArea(title: string, areas: Area[]): string | undefined {
  const have = new Set(areas.map((a) => a.id));
  const guess = bestArea(title, have);
  if (guess) return guess.id;
  return have.has("others") ? "others" : undefined;
}
