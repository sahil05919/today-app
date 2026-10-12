import { addDays } from "./dates";
import { isEventDone, markOf } from "./fixed";
import { clashesFor, type Clash } from "./shareClash";
import type { AppData, FixedEvent, ISODate } from "./types";

/**
 * An event the Gmail add-on put in your main calendar with #today-remind gets the same clash check as one shared from Gmail:
 * does it land inside work hours? Shown as a card on Today until you adjust the work start or keep it as it is.
 */
export interface RemindClash {
  event: FixedEvent;
  clash: Clash;
}

export const CLASH_DAYS = 14;

export function remindClashes(data: AppData, today: ISODate): RemindClash[] {
  const last = addDays(today, CLASH_DAYS);
  const answered = new Set(data.settings.clashDismissed ?? []);
  const out: RemindClash[] = [];
  for (const e of data.calendarEvents ?? []) {
    if (!e.remind || !e.start || e.date < today || e.date > last || answered.has(e.id)) continue;
    if (isEventDone(data, e) || markOf(data, e)?.hidden) continue;
    const work = clashesFor(data, { id: e.id, date: e.date, start: markOf(data, e)?.start ?? e.start, end: markOf(data, e)?.end ?? e.end }, today).find((c) => c.kind === "work");
    if (work) out.push({ event: e, clash: work });
  }
  return out.sort((a, b) => a.event.date.localeCompare(b.event.date) || (a.event.start ?? "").localeCompare(b.event.start ?? ""));
}
