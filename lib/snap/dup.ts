import { matchBill } from "../intents";
import type { AppData, ISODate } from "../types";

/**
 * "Is this already in Today?" A match is the same day and a title that says the same thing. Events (yours, and the ones read from
 * the phone's calendar) and open tasks are both checked; the card says what it found and offers Skip or Add anyway.
 */
export interface Dup {
  kind: "event" | "task";
  title: string;
  date: ISODate;
}

const STOP = new Set(["the", "and", "for", "with", "your", "you", "pay", "appointment", "bill", "shift", "event", "delivery", "parcel", "reminder", "at", "to", "of", "a", "an", "on", "in"]);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const toks = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)));

/** The same thing said two ways: one title holds the other, or most of the shorter one's words are in the longer. */
export function similarTitles(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return false;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.6;
}

export function findDuplicate(data: AppData, item: { title: string; date?: ISODate }): Dup | null {
  if (!item.date) return null;
  for (const e of [...(data.events ?? []), ...(data.calendarEvents ?? [])]) {
    if (e.date === item.date && similarTitles(e.title, item.title)) return { kind: "event", title: e.title, date: e.date };
  }
  for (const t of data.tasks) {
    if (t.status === "open" && t.due === item.date && similarTitles(t.title, item.title)) return { kind: "task", title: t.title, date: item.date };
  }
  return null;
}

/** The recurring bill (rent, council tax…) this looks like, if any: its reminders already exist. */
export function matchingBill(data: AppData, title: string): string | undefined {
  return matchBill(title, data.bills ?? [])?.name;
}
