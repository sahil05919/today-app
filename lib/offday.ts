import { addDays } from "./dates";
import { weekStart } from "./stats";
import type { AppData, ISODate } from "./types";

/**
 * Off days. Everyone needs some. You get at most two a week (Mon–Sun). An off day lightens that day to the
 * minimum, one short session, and the planner spreads everything else across the rest of the week.
 */
export const MAX_OFF_DAYS = 2;
/** The one session an off day keeps must be short: 20 minutes at most (Meditation, English reading…). */
export const OFF_DAY_MAX_MIN = 20;
export const OFF_LIMIT_MESSAGE = "You've had your 2 off days this week. Let's do even one small session.";

export const isOffDay = (data: AppData, date: ISODate) => !!data.offDays?.includes(date);

/** Off days already used in the Monday–Sunday week containing `today`. */
export function offDaysThisWeek(data: AppData, today: ISODate): ISODate[] {
  const start = weekStart(today);
  const end = addDays(start, 6);
  return (data.offDays ?? []).filter((d) => d >= start && d <= end).sort();
}

export const offDaysLeft = (data: AppData, today: ISODate) => Math.max(0, MAX_OFF_DAYS - offDaysThisWeek(data, today).length);

export const canTakeOffDay = (data: AppData, date: ISODate) => !isOffDay(data, date) && offDaysLeft(data, date) > 0;
