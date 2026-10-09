import { nextDue } from "./bills";
import { toISO } from "./dates";
import { dayWord, type DoneReceipt, type DoneWhen } from "./done";
import { matchDone, type DoneCandidate, type DoneMatch } from "./doneText";
import { withDefaults } from "./profile";
import type { ParsedCapture } from "./parse";
import { actions, getData } from "./store";

/**
 * Performs a typed tick ("grocery done", "guitar kiya", "paid credit card") through the same markDone the Calendar uses,
 * and handles "Not this one": take the tick back, tick the right item, and remember the phrase for next time (offline).
 */
export interface TickResult {
  /** The candidate that was ticked; null = it asked which one. */
  applied: DoneCandidate | null;
  receipt?: DoneReceipt;
  /** "Grocery run · done early · no reminder Saturday" */
  summary: string;
  /** Everything it could have been (the picker). */
  options: DoneCandidate[];
  /** The words that named it, for remembering a correction. */
  phrase: string;
  /** The tick found nothing to do (already counted). */
  noop: boolean;
}

const partOfWeek = (name: string, reached: string[], who: string) => (reached.length ? ` ${name} done for the week 🎉, ${who || "friend"}.` : "");

function line(c: DoneCandidate, o: ReturnType<typeof actions.markDone>, who: string, today: string): string {
  const areaName = c.target.kind === "session" ? c.label : "";
  const hit = o.reached.length ? partOfWeek(areaName || o.reached.join(", "), o.reached, who) : "";
  if (o.noop) return o.message;
  if (o.early && o.forDate) return `${c.label} · done early · no reminder ${dayWord(o.forDate, today)}${hit}`;
  return `${o.message}${hit}`;
}

/** Ticks one candidate. */
export function tickCandidate(c: DoneCandidate, who: string, now: Date): Pick<TickResult, "receipt" | "summary" | "noop"> {
  const o = actions.markDone(c.target, { when: c.when, now, extra: c.extra });
  return { receipt: o.noop ? undefined : o.receipt, summary: line(c, o, who, toISO(now)), noop: o.noop };
}

/** The item that an older detector (or Gemini) already named, as a candidate for the tick. */
function direct(p: ParsedCapture, now: Date): DoneCandidate | null {
  const today = toISO(now);
  const d = getData();
  if (p.kind === "session" && p.session) {
    const a = withDefaults(d.profile).areas.find((x) => x.id === p.session!.areaId);
    if (!a) return null;
    const date = p.session.date;
    const when: DoneWhen = date === today ? "on-its-day" : date < today ? "backdate" : "today";
    return { target: { kind: "session", areaId: a.id, date }, when, label: a.name, dayLabel: dayWord(date, today), item: `session:${a.id}`, score: 1, date };
  }
  if (p.kind === "paid" && p.paidBillId) {
    const b = d.bills?.find((x) => x.id === p.paidBillId);
    if (!b) return null;
    const due = nextDue(b, today) ?? today;
    return { target: { kind: "bill", id: b.id, due }, when: due === today ? "on-its-day" : "today", label: b.name, dayLabel: dayWord(due, today), item: `bill:${b.id}`, score: 1, date: due };
  }
  return null;
}

/**
 * What a tick-like capture does. `pick` = an index into the candidates chosen by Gemini (only ever between our candidates).
 * Returns null if it turns out not to be a tick after all (the caller falls back to an ordinary task).
 */
export function tickFromText(text: string, p: ParsedCapture, who: string, now: Date, pick?: number | null): TickResult | null {
  const data = getData();
  const force = p.kind === "session" && p.session ? `session:${p.session.areaId}` : p.kind === "paid" && p.paidBillId ? `bill:${p.paidBillId}` : undefined;
  let m: DoneMatch | null = matchDone(text, data, now, { force, fallback: true });
  if (!m && force) {
    const c = direct(p, now);
    if (c) m = { candidates: [c], sure: true, phrase: "" };
  }
  if (!m) return null;
  const choice = pick != null && m.candidates[pick] ? m.candidates[pick] : m.sure ? m.candidates[0] : null;
  if (!choice) return { applied: null, summary: "Which one did you mean?", options: m.candidates, phrase: m.phrase, noop: true };
  return { applied: choice, ...tickCandidate(choice, who, now), options: m.candidates, phrase: m.phrase };
}

/** Remembers that these words mean this item, so next time it is matched offline without asking. */
export function learnTick(phrase: string, c: DoneCandidate) {
  if (!phrase.trim()) return;
  actions.learnDone(phrase, c.item);
  // A session phrase also teaches the dictionary the word, so ordinary captures file under that area too.
  if (c.target.kind === "session" && phrase.split(/\s+/).length <= 2) actions.addUserWords(phrase.split(/\s+/), c.target.areaId);
}

/** "Not this one": takes the wrong tick back, ticks the right one, and learns the phrase. */
export function correctTick(prev: TickResult, next: DoneCandidate, who: string, now: Date): TickResult {
  if (prev.receipt) actions.undoDone(prev.receipt, now);
  learnTick(prev.phrase, next);
  return { applied: next, ...tickCandidate(next, who, now), options: prev.options, phrase: prev.phrase };
}
