import { isUnknown } from "./dictionary";
import { significantWords } from "./learn";
import type { ParsedCapture } from "./parse";
import type { AppData } from "./types";

/**
 * "Teach me": when something you write isn't in the offline dictionary at all (and wasn't tagged by you), the app offers to
 * add its key word to your dictionary, so next time it knows without Gemini and without asking. If Gemini did find an area
 * for it, that area is the suggestion, which is how Gemini's good guesses become offline knowledge.
 */
export interface Teach {
  /** The words worth teaching, strongest first (at most two). */
  words: string[];
  /** Where Gemini filed it, if it did. */
  suggested?: string;
}

const MIN_WORD = 3;

export function teachSuggestion(p: ParsedCapture, data: AppData): Teach | null {
  if (p.kind && p.kind !== "task") return null;
  if (p.areaSource === "explicit" || p.areaSource === "learned") return null;
  if (!isUnknown(p.raw ?? p.title, data.userWords)) return null;
  const words = significantWords(p.title)
    .filter((w) => w.length >= MIN_WORD)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  if (!words.length) return null;
  const suggested = p.source === "ai" && p.area && p.area !== "others" ? p.area : undefined;
  return { words, suggested };
}
