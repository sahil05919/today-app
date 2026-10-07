import { addDays, toISO } from "./dates";
import { isNative } from "./platform";
import type { FixedEvent, ISODate } from "./types";

/**
 * The phone's calendar (Google Calendar, Gmail invites, anything synced to Android) shows up as fixed blocks.
 * Read-only and offline: it reads Android's Calendar Provider through our small native plugin; nothing is sent anywhere
 * and nothing is ever written back. This file is the pure part: turning what Android returns (and .ics invites) into events.
 */
export interface RawCalendarEvent {
  id: string;
  title: string;
  /** Epoch ms. All-day events are UTC midnights (Android's rule); `end` is exclusive. */
  begin: number;
  end: number;
  allDay: boolean;
  location?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const utcDate = (ms: number): ISODate => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const MAX_SPAN_DAYS = 14;

/** Android's events → one FixedEvent per day they touch (a long event is clipped to each day). */
export function convertCalendarEvents(raw: RawCalendarEvent[], now = Date.now()): FixedEvent[] {
  const out: FixedEvent[] = [];
  for (const e of raw) {
    if (!e || !Number.isFinite(e.begin) || !Number.isFinite(e.end)) continue;
    const title = (e.title || "Event").trim().slice(0, 120) || "Event";
    if (e.allDay) {
      const first = utcDate(e.begin);
      const last = utcDate(Math.max(e.begin, e.end - 1));
      for (let d = first, i = 0; d <= last && i < MAX_SPAN_DAYS; d = addDays(d, 1), i++) {
        out.push({ id: `cal:${e.id}:${d}`, calId: e.id, title, date: d, createdAt: now, source: "calendar" });
      }
      continue;
    }
    const start = new Date(e.begin);
    const end = new Date(Math.max(e.end, e.begin + 5 * 60_000));
    let day = toISO(start);
    for (let i = 0; i < MAX_SPAN_DAYS; i++) {
      const dayStart = new Date(`${day}T00:00:00`);
      const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
      const s = start > dayStart ? start : dayStart;
      const f = end < dayEnd ? end : dayEnd;
      if (f.getTime() > s.getTime()) {
        out.push({
          id: `cal:${e.id}:${day}`,
          calId: e.id,
          title,
          date: day,
          start: hhmm(s),
          // The end of a day is "23:59", never "00:00" (which would read as the start of the day).
          end: f.getTime() >= dayEnd.getTime() ? "23:59" : hhmm(f),
          createdAt: now,
          source: "calendar",
        });
      }
      if (end.getTime() <= dayEnd.getTime()) break;
      day = addDays(day, 1);
    }
  }
  return out;
}

/** The window we mirror: a few days back (for the calendar view) and about two months ahead. */
export const syncWindow = (now = new Date()) => ({
  from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime(),
  to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 62).getTime(),
});

// ---- .ics invites ("Open with Today") -------------------------------------------------------------------

export interface IcsEvent {
  title: string;
  date: ISODate;
  start?: string;
  end?: string;
  location?: string;
}

/** Joins folded lines ("\r\n " continues the previous line) and splits into lines. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

const unescapeText = (s: string) => s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();

/** "20261007T150000Z", "20261007T150000", "20261007" → a local Date (or an all-day date). */
function parseIcsDate(value: string, params: string): { date: ISODate; time?: string; ms?: number } | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined || /VALUE=DATE(?!-)/i.test(params)) return { date: `${y}-${mo}-${d}` };
  const local = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)) : new Date(+y, +mo - 1, +d, +h, +mi);
  return { date: toISO(local), time: hhmm(local), ms: local.getTime() };
}

/** Reads the events out of an .ics file. Recurrence rules are ignored: only the first occurrence is added. */
export function parseICS(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = {};
    else if (/^END:VEVENT/i.test(line)) {
      if (cur?.DTSTART) {
        const s = parseIcsDate(cur.DTSTART.value, cur.DTSTART.params);
        const e = cur.DTEND ? parseIcsDate(cur.DTEND.value, cur.DTEND.params) : null;
        if (s) {
          const title = unescapeText(cur.SUMMARY?.value ?? "") || "Event";
          out.push({
            title: title.slice(0, 120),
            date: s.date,
            start: s.time,
            // An end on another day is clipped to the end of the start day.
            end: s.time && e?.time ? (e.date === s.date ? e.time : "23:59") : undefined,
            location: cur.LOCATION ? unescapeText(cur.LOCATION.value) : undefined,
          });
        }
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(";");
      cur[name.toUpperCase()] = { value: line.slice(i + 1), params: params.join(";") };
    }
  }
  return out;
}

// ---- Talking to the phone (Android only) -----------------------------------------------------------------

export type CalendarAccess = "granted" | "denied" | "prompt" | "unsupported";

const ASKED_KEY = "today:calendar-asked";
export const calendarAsked = () => {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
};
export const markCalendarAsked = () => {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
};

export const calendarSupported = () => isNative();
