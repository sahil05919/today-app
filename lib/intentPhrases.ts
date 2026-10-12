/**
 * Typed phrases that are COMMANDS, not tasks: "work done", "I'm free", "pull work", "lighten my week", "aaj ka kaam ho gaya".
 * They are recognised offline before any task capture, so they can never be saved as a task (and a stray one that was saved
 * by an older build is cleaned up by lib/cleanup.ts).
 */
import { isAppNote } from "./appNotes";
import { parseClear } from "./clearParse";
import { parseLogged } from "./workLog";

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const LIGHTEN: RegExp[] = [
  /^(all )?(my )?(today'?s )?work( is)?( all)? done( for today| for the day)?( now)?( please)?$/,
  /^(i'?m|i am) done( for today| for the day)?$/,
  /^done for (the )?(today|day)( now)?$/,
  /^(i'?m|i am) free( now| today| tonight| this evening)?$/,
  /^pull (some )?(more )?work( forward| in)?( please)?$/,
  /^give me (some )?more( work| tasks| things)?( please)?$/,
  /^lighten my (week|load)( please)?$/,
  /^aaj ka kaam (ho gaya|hogaya|khatam)( hai)?$/,
  /^aur kaam do( yaar)?$/,
  /^(main |mai |me )?free (hoon|hu|hun)( abhi)?$/,
  // The sentence that was once saved as a task: "Can you take out some work from future and adjust in"
  /^(can|could|would) you (please )?(take|pull|bring|move)( out)? (some |more )?(of )?(the )?work (from|out of) (the )?(future|later|next week|coming days)( and (adjust|add|put)( it)?( in| today| here)?)?( for me)?$/,
  /^(take|pull|bring)( out)? (some |more )?work (from|out of) (the )?(future|later|next week|coming days)( and (adjust|add|put)( it)?( in| today| here)?)?$/,
];

/** "work done", "I'm free", "lighten my week"… (English, Hinglish). */
export function isLightenIntent(text: string): boolean {
  const t = norm(text);
  return !!t && LIGHTEN.some((re) => re.test(t));
}

/** A title that is really a command (so a task with this title is a leftover, never something to plan). */
export const isCommandTitle = (text: string) => isLightenIntent(text) || isAppNote(text) || parseLogged(text, new Date()) !== null || parseClear(text, new Date()) !== null;

/** What a typed line means when it is not a task: "lighten" (work done, I'm free…), "app" (a note for the app: "app: …"). */
export type Intent = "lighten" | "app" | "clear" | "log";
export function intentOf(text: string): Intent | null {
  if (isAppNote(text)) return "app";
  if (parseClear(text, new Date()) !== null) return "clear";
  if (parseLogged(text, new Date()) !== null) return "log";
  return isLightenIntent(text) ? "lighten" : null;
}
