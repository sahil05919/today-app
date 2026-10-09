import { todayISO } from "./dates";
import { needsLetter, writeLetter } from "./coach";
import { actions, getData } from "./store";

let inflight: Promise<void> | null = null;

/** Writes this week's coach letter if it doesn't exist yet, and saves it. Safe to call often: it writes at most once a week. */
export function ensureLetter(): Promise<void> {
  const data = getData();
  const today = todayISO();
  if (!needsLetter(data, today)) return Promise.resolve();
  if (inflight) return inflight;
  inflight = writeLetter(data, today)
    .then((letter) => {
      // Someone else may have written it while we waited.
      if (needsLetter(getData(), today)) actions.saveLetter(letter);
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
