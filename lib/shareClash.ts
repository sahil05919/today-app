import { dayRules, timedTasksOn } from "./busy";
import { allEvents, eventSpan } from "./fixed";
import { toHHMM, toMin } from "./profile";
import { withRepeats } from "./series";
import type { AppData, FixedEvent, ISODate } from "./types";

/**
 * Does a new event clash with work hours or with something already fixed that day? Shown on the confirm sheet, with the
 * options "Adjust work start that day" (a Just-today routine edit) or "Keep anyway". Pure.
 */
export interface Clash {
  kind: "work" | "fixed";
  text: string;
  /** For a work clash that sits at the start of the day: the new work start that clears it (minutes after midnight), and the length it keeps. */
  fix?: { start: number; min: number };
}

type Draft = Pick<FixedEvent, "date" | "start" | "end"> & { id?: string };

const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/** How long the event is taken to last when it has no end: an hour. */
const spanOf = (e: Draft): [number, number] | null => (e.start ? eventSpan({ ...e, id: e.id ?? "draft", title: "", createdAt: 0 } as FixedEvent) : null);

export function clashesFor(raw: AppData, e: Draft, today: ISODate = e.date): Clash[] {
  const span = spanOf(e);
  if (!span) return []; // an all-day event does not take a clock time: the day's sessions simply move elsewhere
  const data = withRepeats(raw, today);
  const out: Clash[] = [];

  const r = dayRules(data, e.date);
  if (r.workDay && !r.off && r.work && overlaps(span, r.work)) {
    const text = `Clashes with work ${toHHMM(r.work[0])}–${toHHMM(r.work[1])}. Book leave or adjust work start?`;
    // Only an event that eats the START of work can be cleared by starting later (30 minutes to get there).
    const start = Math.ceil((span[1] + 30) / 5) * 5;
    out.push({ kind: "work", text, fix: span[0] <= r.work[0] && start < r.work[1] ? { start, min: r.work[1] - start } : undefined });
  }

  for (const other of allEvents(data)) {
    if (other.date !== e.date || other.id === e.id || !other.start) continue;
    if (overlaps(span, eventSpan(other))) out.push({ kind: "fixed", text: `Clashes with ${other.title} at ${other.start}.` });
  }
  for (const t of timedTasksOn(data, e.date)) {
    const s = toMin(t.dueTime!);
    if (overlaps(span, [s, s + 15])) out.push({ kind: "fixed", text: `Clashes with ${t.title} at ${t.dueTime}.` });
  }
  return out;
}
