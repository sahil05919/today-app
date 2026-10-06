import type { ISODate } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now = new Date()): ISODate {
  return toISO(now);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000);
}

export function isISO(s: unknown): s is ISODate {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromISO(s).getTime());
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const weekdayShort = (s: ISODate) => WD[fromISO(s).getDay()];
export const dayOfMonth = (s: ISODate) => fromISO(s).getDate();

/** "Today", "Tomorrow", "Yesterday", "Sat 11 Oct" (adds year if not this year). */
export function friendlyDate(s: ISODate, today: ISODate): string {
  const diff = diffDays(s, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromISO(s);
  const base = `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
  return d.getFullYear() === fromISO(today).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Still up?";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function longDate(now = new Date()): string {
  return `${WD_LONG[now.getDay()]} ${now.getDate()} ${MO[now.getMonth()]}`;
}

/** "15 Oct" */
export function shortDate(s: ISODate): string {
  const d = fromISO(s);
  return `${d.getDate()} ${MO[d.getMonth()]}`;
}

/** "15 Oct" or "15 Oct – 15 Nov" */
export function rangeLabel(start: ISODate, end: ISODate): string {
  return start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`;
}
