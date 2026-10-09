import { addDays, fromISO } from "./dates";
import { toHHMM } from "./profile";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, ISODate } from "./types";

/** One day of the "Next 3 days" strip on Today. */
export interface UpcomingDay {
  date: ISODate;
  /** "Tomorrow", "Day after", then the weekday. */
  label: string;
  /** "Fri 9 Oct" */
  dateText: string;
  /** Things that are still open that day (breaks and commute don't count). */
  count: number;
  /** The first few: fixed things first, with their times. */
  top: Array<{ time?: string; title: string; fixed: boolean }>;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Everything on a day worth listing: no breaks or commute, nothing already done or skipped. */
export const listable = (items: TLItem[]) => items.filter((x) => !x.muted && !x.done && !x.skipped);

/**
 * The next few days at a glance, built from the same `buildTimeline` the planner uses, so the strip
 * shows what will really happen (not a second opinion).
 */
export function upcomingDays(data: AppData, today: ISODate, days = 3, perDay = 3): UpcomingDay[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i + 1);
    const items = listable(buildTimeline(data, date, fromISO(date)).items);
    // Fixed things (events, timed tasks) first, in time order; then the flexible ones in the order they'll happen.
    const ordered = [...items.filter((x) => x.fixed || x.kind === "event" || x.kind === "calendar"), ...items.filter((x) => !(x.fixed || x.kind === "event" || x.kind === "calendar"))];
    const d = fromISO(date);
    return {
      date,
      label: i === 0 ? "Tomorrow" : i === 1 ? "Day after" : WEEKDAYS[d.getDay()],
      dateText: `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`,
      count: items.length,
      top: ordered.slice(0, perDay).map((x) => ({ time: x.allDay ? undefined : x.fixed || x.kind === "event" || x.kind === "calendar" ? toHHMM(x.start) : undefined, title: x.title, fixed: x.fixed })),
    };
  });
}
