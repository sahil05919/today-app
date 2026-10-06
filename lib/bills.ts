import { addDays, diffDays, fromISO, toISO } from "./dates";
import { entryFor } from "./sessions";
import type { AppData, Bill, ISODate } from "./types";

export const billKey = (id: string, due: ISODate) => `bill:${id}:${due}`;

/** The nth day of a month, clamped to its length (the 31st of April is the 30th). */
function monthDay(year: number, month0: number, day: number): ISODate {
  const last = new Date(year, month0 + 1, 0).getDate();
  return toISO(new Date(year, month0, Math.min(day, last)));
}

/** Due dates from `from` up to `to` (inclusive). "Every N days" only ever has its next one. */
export function dueDates(b: Bill, from: ISODate, to: ISODate, today: ISODate = from): ISODate[] {
  const out: ISODate[] = [];
  if (from > to) return out;
  if (b.schedule.type === "monthly") {
    const z = fromISO(to);
    let y = fromISO(from).getFullYear();
    let m = fromISO(from).getMonth();
    for (;;) {
      const d = monthDay(y, m, b.schedule.day);
      if (d >= from && d <= to) out.push(d);
      if (y === z.getFullYear() && m === z.getMonth()) break;
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  } else if (b.schedule.type === "weekly") {
    for (let d = from; d <= to; d = addDays(d, 1)) if (fromISO(d).getDay() === b.schedule.dow) out.push(d);
  } else {
    const first = b.lastDone ? addDays(b.lastDone, b.schedule.days) : (b.startDate ?? from);
    // Overdue things are due today (not on every day you look at); they don't pile up.
    const due = first < today ? today : first;
    if (due >= from && due <= to) out.push(due);
  }
  return out;
}

export interface BillReminder {
  bill: Bill;
  due: ISODate;
  /** The day to remind (due date minus the offset). */
  date: ISODate;
  /** Days before it's due (0 = on the day). */
  offset: number;
  /** "bill:<id>:<due>": what Done / Skip / Snooze refer to. */
  key: string;
}

/**
 * Every reminder that should fire between `from` and `to`, skipping bills on autopay or switched off,
 * and occurrences you've already marked done or skipped.
 */
export function billReminders(data: AppData, from: ISODate, to: ISODate, today: ISODate = from): BillReminder[] {
  const out: BillReminder[] = [];
  for (const bill of data.bills ?? []) {
    if (!bill.enabled || bill.autopay || !bill.remindDaysBefore.length) continue;
    const maxOffset = Math.max(...bill.remindDaysBefore);
    for (const due of dueDates(bill, from, addDays(to, maxOffset), today)) {
      const key = billKey(bill.id, due);
      const e = entryFor(data.log, key);
      if (e && e.status !== "snooze") continue;
      for (const offset of bill.remindDaysBefore) {
        const date = addDays(due, -offset);
        if (date >= from && date <= to) out.push({ bill, due, date, offset, key });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.bill.time.localeCompare(b.bill.time));
}

/** What a bill / chore row on a given day should say, and whether it's still open. */
export function billsOnDay(data: AppData, date: ISODate, today: ISODate = date) {
  return billReminders(data, date, date, today).map((r) => ({
    ...r,
    label: r.offset === 0 ? (r.bill.kind === "chore" ? "Today" : "Due today") : r.offset === 1 ? "Due tomorrow" : `Due in ${r.offset} days`,
  }));
}

/** Next due date on or after `today`, for the Bills list. */
export function nextDue(b: Bill, today: ISODate): ISODate | null {
  const horizon = b.schedule.type === "monthly" ? addDays(today, 62) : addDays(today, 14);
  return dueDates(b, today, horizon)[0] ?? null;
}

export function describeSchedule(b: Bill): string {
  const s = b.schedule;
  const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
  if (s.type === "monthly") return `Monthly, the ${ord(s.day)}`;
  if (s.type === "weekly") return `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.dow]}`;
  return s.days === 1 ? "Every day" : `Every ${s.days} days`;
}

export function reminderText(b: Bill, offset: number): string {
  if (offset === 0) return b.kind === "chore" ? b.name : `${b.name} · today`;
  return `${b.name} · in ${offset} day${offset === 1 ? "" : "s"}`;
}

export const daysUntil = (due: ISODate, today: ISODate) => diffDays(due, today);
