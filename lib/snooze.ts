import { addDays, toISO } from "./dates";
import type { ISODate } from "./types";

export type WhenKind = "later-today" | "today" | "tomorrow" | "weekend" | "next-week";

/** Date for each quick option. Weekend = the coming Saturday (Sunday if it's already Saturday). */
export function whenDate(kind: WhenKind, now = new Date()): ISODate {
  const today = toISO(now);
  const dow = now.getDay();
  switch (kind) {
    case "later-today":
    case "today":
      return today;
    case "tomorrow":
      return addDays(today, 1);
    case "weekend":
      return addDays(today, dow === 6 ? 1 : dow === 0 ? 6 : 6 - dow);
    case "next-week": // next Monday
      return addDays(today, (8 - dow) % 7 || 7);
  }
}

/** For "later today" on a task that has a time: roughly 3 hours from now, on the hour, capped at 21:00. */
export function laterTodayTime(now = new Date()): string {
  const h = Math.min(21, now.getHours() + 3);
  return `${String(h).padStart(2, "0")}:00`;
}

export const WHEN_LABEL: Record<WhenKind, string> = {
  "later-today": "Later today",
  today: "Today",
  tomorrow: "Tomorrow",
  weekend: "This weekend",
  "next-week": "Next week",
};
