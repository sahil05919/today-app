import type { ISODate } from "./types";

/**
 * One-tap alarms for early starts. Anything that starts before 08:00 (a 07:00 shift, an early event, a task you timed) gets a
 * "Set alarm" button. It makes a REAL Android alarm (the clock app's), `wake-up lead` minutes before the start (Settings, 90 by
 * default: a 07:00 shift rings at 05:30).
 *
 * Android's alarm intent has no date, only a time: the alarm rings at the next such time. So the button is only offered within 24 hours
 * of the alarm time (otherwise it would ring the wrong morning), and before that the sheet says "Available the evening before".
 */
export const EARLY_BEFORE_MIN = 8 * 60;
export const DEFAULT_WAKE_LEAD_MIN = 90;
const DAY_MS = 86_400_000;

/** Starts before 08:00. */
export const isEarlyStart = (startMin: number) => startMin >= 0 && startMin < EARLY_BEFORE_MIN;

/** When the alarm should ring: the start minus the lead, as a real moment (it can fall on the day before). */
export function alarmMoment(date: ISODate, startMin: number, leadMin: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, startMin - leadMin, 0, 0);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmmOf = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

export type AlarmOffer =
  | { kind: "none" }
  /** Not yet: the alarm time is more than 24 hours away. */
  | { kind: "later"; at: Date; time: string; note: string }
  /** Tap to set it. */
  | { kind: "ready"; at: Date; time: string; hour: number; minutes: number }
  /** The alarm time has already gone by. */
  | { kind: "passed"; time: string };

export function alarmOffer(date: ISODate, startMin: number, now: Date, leadMin: number = DEFAULT_WAKE_LEAD_MIN): AlarmOffer {
  if (!isEarlyStart(startMin)) return { kind: "none" };
  const at = alarmMoment(date, startMin, leadMin);
  const time = hhmmOf(at);
  const ahead = at.getTime() - now.getTime();
  if (ahead <= 0) return { kind: "passed", time };
  if (ahead > DAY_MS) return { kind: "later", at, time, note: "Available the evening before" };
  return { kind: "ready", at, time, hour: at.getHours(), minutes: at.getMinutes() };
}

/** The key that remembers "alarm set" for one item on one day. */
export const alarmKey = (itemKey: string, date: ISODate) => `${itemKey}@${date}`;

/** The mark shown once it is set. */
export const alarmSetLine = (time: string) => `⏰ alarm set ${time}`;

/** What the night-before notification carries so its button can set the alarm without opening anything. */
export interface AlarmAction {
  hour: number;
  minutes: number;
  message: string;
  /** alarmKey(): what to mark afterwards. */
  key: string;
  time: string;
}

export function alarmActionFor(itemKey: string, title: string, date: ISODate, startMin: number, leadMin: number = DEFAULT_WAKE_LEAD_MIN): AlarmAction | null {
  if (!isEarlyStart(startMin)) return null;
  const at = alarmMoment(date, startMin, leadMin);
  return { hour: at.getHours(), minutes: at.getMinutes(), message: title.slice(0, 80), key: alarmKey(itemKey, date), time: hhmmOf(at) };
}
