import { addDays, fromISO, toISO } from "./dates";
import type { ISODate, Recurrence } from "./types";

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowOf = (s: string) => DOW[s.slice(0, 3).toLowerCase()];
const WD = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const WD_LIST = `${WD}(?:\\s*(?:,|and|&|\\/)\\s*${WD})*`;
const WEEKDAYS = [1, 2, 3, 4, 5];

const unit = (u: string): Recurrence["freq"] => (/^d/i.test(u) ? "daily" : /^w/i.test(u) ? "weekly" : "monthly");
const parseDays = (s: string) => [...new Set((s.match(new RegExp(WD, "gi")) ?? []).map(dowOf))].sort();

/** Finds a repeat phrase ("every Monday", "daily", "weekdays", "every 1st"…) and removes it from the text. */
export function extractRecurrence(text: string): { text: string; recur?: Recurrence } {
  const rules: [RegExp, (m: RegExpExecArray) => Recurrence][] = [
    [/\b(?:every\s+weekdays?|weekdays)\b/i, () => ({ freq: "weekly", interval: 1, weekdays: WEEKDAYS })],
    [new RegExp(`\\bevery\\s+other\\s+(${WD})\\b`, "i"), (m) => ({ freq: "weekly", interval: 2, weekdays: [dowOf(m[1])] })],
    [/\bevery\s+other\s+(day|week|month)\b/i, (m) => ({ freq: unit(m[1]), interval: 2 })],
    [/\bevery\s+(\d+)\s*(day|week|month)s?\b/i, (m) => ({ freq: unit(m[2]), interval: Math.max(1, +m[1]) })],
    [new RegExp(`\\bevery\\s+(${WD_LIST})\\b`, "i"), (m) => ({ freq: "weekly", interval: 1, weekdays: parseDays(m[1]) })],
    [
      /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b/i,
      (m) => ({ freq: "monthly", interval: 1, monthDay: Math.min(31, Math.max(1, +m[1])) }),
    ],
    [
      /\bevery\s+(?:month\s+on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i,
      (m) => ({ freq: "monthly", interval: 1, monthDay: Math.min(31, Math.max(1, +m[1])) }),
    ],
    [/\b(?:daily|every\s*day|everyday)\b/i, () => ({ freq: "daily", interval: 1 })],
    [/\b(?:weekly|every\s+week)\b/i, () => ({ freq: "weekly", interval: 1 })],
    [/\b(?:monthly|every\s+month)\b/i, () => ({ freq: "monthly", interval: 1 })],
  ];
  for (const [re, build] of rules) {
    const m = re.exec(text);
    if (m) return { text: text.replace(m[0], " "), recur: build(m) };
  }
  return { text };
}

const dayNum = (iso: ISODate) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};
/** Monday-based week index (1970-01-01 was a Thursday). */
const weekNum = (iso: ISODate) => Math.floor((dayNum(iso) + 3) / 7);
const dow = (iso: ISODate) => fromISO(iso).getDay();

function addMonths(iso: ISODate, n: number, day: number): ISODate {
  const d = fromISO(iso);
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return toISO(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last)));
}

/** First date on or after `from` that fits the rule. */
export function firstOccurrence(r: Recurrence, from: ISODate): ISODate {
  if (r.freq === "weekly" && r.weekdays?.length) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      if (r.weekdays.includes(dow(d))) return d;
    }
  }
  if (r.freq === "monthly" && r.monthDay) {
    const cand = addMonths(from, 0, r.monthDay);
    return cand >= from ? cand : addMonths(from, 1, r.monthDay);
  }
  return from;
}

/** First date strictly after `after`. */
export function nextOccurrence(r: Recurrence, after: ISODate): ISODate {
  const n = Math.max(1, r.interval);
  if (r.freq === "daily") return addDays(after, n);
  if (r.freq === "weekly") {
    if (!r.weekdays?.length) return addDays(after, 7 * n);
    for (let i = 1; i <= 7 * n + 7; i++) {
      const d = addDays(after, i);
      if (r.weekdays.includes(dow(d)) && (weekNum(d) - weekNum(after)) % n === 0) return d;
    }
    return addDays(after, 7 * n);
  }
  const day = r.monthDay ?? fromISO(after).getDate();
  if (r.monthDay) {
    const cand = addMonths(after, 0, day);
    if (cand > after) return cand;
  }
  return addMonths(after, n, day);
}

const ordinal = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

export function recurLabel(r: Recurrence): string {
  const n = r.interval;
  if (r.freq === "daily") return n === 1 ? "Daily" : `Every ${n} days`;
  if (r.freq === "weekly") {
    const wd = r.weekdays ?? [];
    if (n === 1 && wd.length === 5 && WEEKDAYS.every((d) => wd.includes(d))) return "Weekdays";
    if (wd.length) return `${n === 1 ? "Every" : `Every ${n} wks:`} ${wd.map((d) => DOW_NAMES[d]).join(", ")}`;
    return n === 1 ? "Weekly" : `Every ${n} weeks`;
  }
  if (r.monthDay) return n === 1 ? `Monthly, ${ordinal(r.monthDay)}` : `Every ${n} months, ${ordinal(r.monthDay)}`;
  return n === 1 ? "Monthly" : `Every ${n} months`;
}
