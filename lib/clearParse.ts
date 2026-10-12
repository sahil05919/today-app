import { addDays, toISO } from "./dates";
import type { ISODate } from "./types";

/** The latest an automatic plan runs (the same 22:30 as lib/busy.ts; repeated here to keep this file light). */
const LATEST_END = 22 * 60 + 30;

/**
 * The "clear" command: "clear until 7pm", "clear tomorrow", "clear 13 oct 2-4pm", "aaj 7 baje tak clear", "kal clear karo".
 * It is an ACTION, never a task, and is understood offline (no Gemini). This file only reads the words; lib/clear.ts decides what
 * moves and applies it.
 */
export interface ClearWindow {
  date: ISODate;
  /** Minutes after midnight; end is exclusive. */
  start: number;
  end: number;
}

export interface ClearParse {
  /** The windows to clear (one per day; a clear across midnight is two). Empty when the words did not say enough. */
  windows: ClearWindow[];
  /** "until 19:00", "tomorrow", "13 Oct 14:00–16:00" for the preview heading. */
  label: string;
  /** What was understood even if it was not enough, to prefill the range picker. */
  understood: { date?: ISODate; start?: number; end?: number };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
/** Part-of-day words. "Morning" starts at 11:00 because nothing is planned before then. */
const PARTS: Record<string, [number, number]> = {
  morning: [11 * 60, 13 * 60],
  subah: [11 * 60, 13 * 60],
  afternoon: [13 * 60, 17 * 60],
  dopahar: [13 * 60, 17 * 60],
  evening: [17 * 60, LATEST_END],
  shaam: [17 * 60, LATEST_END],
  night: [20 * 60 + 30, LATEST_END],
  raat: [20 * 60 + 30, LATEST_END],
};
/** Words that may stay in the sentence without making it "something else" (a task such as "clear the garage"). */
const FILLER = new Set(["clear", "my", "the", "a", "all", "of", "rest", "remaining", "day", "calendar", "schedule", "plan", "please", "pls", "karo", "kar", "do", "dena", "diary", "for", "on", "from", "me", "mera", "meri", "ka", "ke", "ki", "se", "hai", "it", "up", "everything", "is", "ko", "at", "and", "tak", "baje", "till", "until", "upto", "to", "by", "before", "next", "this", "coming"]);

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const nowMin = (now: Date) => now.getHours() * 60 + now.getMinutes();
const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** Does this line ask to clear time? (Starts with "clear", or has "clear" with aaj / kal.) Says nothing about whether it is understood. */
export function mentionsClear(text: string): boolean {
  const t = text.toLowerCase();
  return /^\s*clear\b/.test(t) || (/\bclear\b/.test(t) && /\b(aaj|aj|kal)\b/.test(t));
}

/** 1-12 without am/pm: 1-7 and 12 are afternoon/evening, 8-11 morning; 13+ is already 24-hour. */
function toMinutes(h: number, m: number, mer?: string): number | null {
  if (h > 24 || m > 59) return null;
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 7) h += 12;
  else if (!mer && h === 12) h = 12;
  return h * 60 + m;
}

function takeDate(s: string, now: Date): { date?: ISODate; rest: string; today?: boolean; weekdayOnly?: boolean } {
  const today = toISO(now);
  let m: RegExpExecArray | null;
  if ((m = /\b(?:day after tomorrow|parso)\b/.exec(s))) return { date: addDays(today, 2), rest: s.replace(m[0], " ") };
  if ((m = /\b(?:tomorrow|tmrw|tmr|kal)\b/.exec(s))) return { date: addDays(today, 1), rest: s.replace(m[0], " ") };
  if ((m = /\b(?:today|aaj|aj|tonight)\b/.exec(s))) return { date: today, rest: s.replace(m[0], " "), today: true };
  // 13 oct / 13th october / oct 13
  if ((m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/.exec(s)) || (m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s))) {
    const [day, mon] = /^\d/.test(m[1]) ? [Number(m[1]), MONTHS[m[2]]] : [Number(m[2]), MONTHS[m[1]]];
    return { date: toISO(new Date(now.getFullYear(), mon, day)), rest: s.replace(m[0], " ") };
  }
  // 13/10 (day/month)
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/.exec(s)) && Number(m[1]) <= 31 && Number(m[2]) <= 12) {
    return { date: toISO(new Date(now.getFullYear(), Number(m[2]) - 1, Number(m[1]))), rest: s.replace(m[0], " ") };
  }
  if ((m = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/.exec(s)) && m[1] in WEEKDAYS) {
    const ahead = (WEEKDAYS[m[1]] - now.getDay() + 7) % 7;
    return { date: addDays(today, ahead), rest: s.replace(m[0], " "), weekdayOnly: true };
  }
  return { rest: s };
}

const T = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?`;

/** Reads a command to clear time. null = not a clear command at all (so the text stays an ordinary task). */
export function parseClear(text: string, now: Date, opts: { dayEnd?: number } = {}): ClearParse | null {
  if (!mentionsClear(text)) return null;
  const dayEnd = opts.dayEnd ?? LATEST_END;
  const today = toISO(now);
  let s = ` ${text.toLowerCase().replace(/[,!?;]/g, " ").replace(/\s+/g, " ")} `;

  // 1. A time range: "2-4pm", "14:00-16:00", "2 to 4", "2 se 4". (Before the date, so "13/10 14:00-16:00" keeps its time.)
  let range: [number, number] | null = null;
  let badRange = false;
  const dateFirst = takeDate(s, now);
  s = dateFirst.rest;
  let m = new RegExp(String.raw`\b${T}\s*(?:-|–|—|to|se)\s*${T}\b`).exec(s);
  if (m) {
    const [, h1, m1, mer1, h2, m2, mer2] = m;
    const e = toMinutes(Number(h2), Number(m2 ?? 0), mer2);
    let st = toMinutes(Number(h1), Number(m1 ?? 0), mer1 ?? mer2);
    if (st != null && e != null && st >= e) {
      // "10-12pm" is 10am-12pm; "9 to 5" is 9am-5pm.
      if (!mer1 && mer2) st = toMinutes(Number(h1), Number(m1 ?? 0), mer2 === "pm" ? "am" : "pm");
      else if (!mer1 && !mer2 && Number(h1) <= 12 && st >= 12 * 60) st -= 12 * 60;
    }
    range = st != null && e != null && st < e ? [st, e] : null;
    badRange = !range;
    s = s.replace(m[0], " ");
  }

  // 2. "until 7pm", "till 19:00", "7 baje tak", "7pm tak"
  let until: number | null = null;
  if (!range) {
    const u = new RegExp(String.raw`\b(?:till|until|upto|up to|before|by)\s+${T}(?:\s*baje)?\b`).exec(s) ?? new RegExp(String.raw`\b${T}\s*(?:baje\s*)?tak\b`).exec(s);
    if (u) {
      until = toMinutes(Number(u[1]), Number(u[2] ?? 0), u[3]);
      s = s.replace(u[0], " ");
    }
  }

  // 3. A part of the day
  let part: [number, number] | null = null;
  const pm = /\b(morning|subah|afternoon|dopahar|evening|shaam|night|raat)\b/.exec(s);
  if (pm) {
    part = PARTS[pm[1]];
    s = s.replace(pm[0], " ");
  }

  // Anything left must be filler; a real word means this is a task ("clear the garage"), not the command.
  const left = s
    .replace(/[^a-zऀ-ॿ ]+/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w));
  if (left.length) return null;

  const date = dateFirst.date;
  const understood: ClearParse["understood"] = {};
  if (date) understood.date = date;
  const day = date ?? today;
  const startOf = (d: ISODate) => (d === today ? Math.min(dayEnd, ceil5(nowMin(now) + 1)) : 0);
  if (badRange) return { windows: [], label: "", understood };
  const out = (windows: ClearWindow[], label: string): ClearParse => ({ windows: windows.filter((w) => w.end > w.start), label, understood });

  if (range) {
    understood.start = range[0];
    understood.end = range[1];
    if (day < today) return { windows: [], label: "", understood };
    // A range that has already begun today starts now.
    const from = day === today ? Math.max(range[0], startOf(today)) : range[0];
    if (from >= range[1]) return { windows: [], label: "", understood };
    return out([{ date: day, start: from, end: range[1] }], `${day === today ? "today" : day} ${hhmm(range[0])}–${hhmm(range[1])}`);
  }
  if (until != null) {
    understood.end = until;
    understood.start = startOf(day);
    if (day === today) {
      if (until <= startOf(today)) return { windows: [], label: "", understood };
      return out([{ date: today, start: startOf(today), end: until }], `until ${hhmm(until)}`);
    }
    // "until 8am tomorrow": from now through the end of today, then the start of that day up to the time.
    const days: ClearWindow[] = [{ date: today, start: startOf(today), end: dayEnd }];
    for (let d = addDays(today, 1); d < day; d = addDays(d, 1)) days.push({ date: d, start: 0, end: dayEnd });
    days.push({ date: day, start: 0, end: until });
    return out(days, `until ${hhmm(until)} ${day === addDays(today, 1) ? "tomorrow" : day}`);
  }
  if (part) {
    understood.start = part[0];
    understood.end = part[1];
    // No day named and this part is over today: it is meant for tomorrow? No: ask, rather than guess.
    if (!date && part[1] <= nowMin(now)) return { windows: [], label: "", understood };
    const from = day === today ? Math.max(part[0], startOf(today)) : part[0];
    return out([{ date: day, start: from, end: part[1] }], `${date ? (day === addDays(today, 1) ? "tomorrow" : day) : "today"} ${pm![1]}`);
  }
  // A day and nothing else: that whole day (today: the rest of it).
  if (date || /\b(rest|remaining)\b/.test(text.toLowerCase()) || /\b(clear|karo|kar)\b/.test(text.toLowerCase())) {
    if (!date && !/\b(rest|remaining)\b/.test(text.toLowerCase()) && !/\b(today|aaj|aj)\b/.test(text.toLowerCase())) {
      // Plain "clear": the words did not say when.
      return { windows: [], label: "", understood };
    }
    if (day < today) return { windows: [], label: "", understood };
    const label = day === today ? "the rest of today" : day === addDays(today, 1) ? "tomorrow" : day;
    return out([{ date: day, start: startOf(day), end: dayEnd }], label);
  }
  return { windows: [], label: "", understood };
}

export interface ClearChip {
  id: "rest" | "until" | "tomorrow" | "range";
  label: string;
  windows: ClearWindow[];
}

/** The chips shown under the input as soon as the text starts with "clear". The last one opens the range picker (no windows). */
export function clearSuggestions(text: string, now: Date, opts: { dayEnd?: number } = {}): ClearChip[] | null {
  if (!mentionsClear(text)) return null;
  const dayEnd = opts.dayEnd ?? LATEST_END;
  const today = toISO(now);
  const from = Math.min(dayEnd, ceil5(nowMin(now) + 1));
  const chips: ClearChip[] = [];
  if (from < dayEnd) chips.push({ id: "rest", label: "Clear rest of today", windows: [{ date: today, start: from, end: dayEnd }] });
  // "Clear until 7 PM": the next round hour, plus two hours.
  const nextRound = (Math.floor(nowMin(now) / 60) + 1) * 60;
  const end = nextRound + 120;
  if (end <= dayEnd && end > from) chips.push({ id: "until", label: `Clear until ${hour12(end)}`, windows: [{ date: today, start: from, end }] });
  chips.push({ id: "tomorrow", label: "Clear tomorrow", windows: [{ date: addDays(today, 1), start: 0, end: dayEnd }] });
  chips.push({ id: "range", label: "Clear a time range…", windows: [] });
  return chips;
}

export function hour12(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? ":" + pad(m) : ""} ${h < 12 ? "AM" : "PM"}`;
}
