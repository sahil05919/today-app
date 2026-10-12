import { toISO } from "./dates";
import { guessSub } from "./other";
import { withDefaults } from "./profile";
import type { AppData, ISODate, SubLabel, WorkLog } from "./types";

/**
 * Time you have already spent, typed in the capture bar and saved at once as a DONE entry (never a to-do):
 *   "spent 2 hrs building the app" · "2h app build" · "worked 45 min on CV" · "did 1 hour cleaning"
 *   "aaj 2 ghante app pe kaam kiya" · "yesterday spent 90 min on forms"
 * Offline. It counts under "Other" in the week (see lib/other.ts), unless it names one of your tracked areas (then it is a session
 * of that area, never counted twice).
 */
export interface LoggedTime {
  minutes: number;
  /** Short label for the toast and the list: "Building app". */
  title: string;
  sub: SubLabel;
  date: ISODate;
  /** The words named a tracked area ("did 1 hour of power bi"): log a session of it instead. */
  areaId?: string;
}

const HOURS = String.raw`(?:h|hr|hrs|hour|hours|ghante|ghanta|ghantay|ghnte)`;
const MINS = String.raw`(?:m|min|mins|minute|minutes|mint)`;
/** Words that make a line a plan for later, not a record of what was done. */
const FUTURE = /\b(tomorrow|tmrw|tonight|next|remind|reminder|every|daily|weekly|before|after|later|at|by)\b|\d\s*(?:am|pm)\b|\d:\d\d/i;

function durationOf(s: string): { minutes: number; matched: string } | null {
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`\b(\d+(?:[.,]\d+)?)\s*${HOURS}\b(?:\s*(?:and\s*)?(\d{1,2})\s*${MINS}\b)?`, "i").exec(s))) {
    const minutes = Math.round(Number(m[1].replace(",", ".")) * 60) + Number(m[2] ?? 0);
    return minutes > 0 && minutes <= 960 ? { minutes, matched: m[0] } : null;
  }
  if ((m = /\b(\d+)h(\d{1,2})\b/i.exec(s))) return { minutes: Number(m[1]) * 60 + Number(m[2]), matched: m[0] };
  if ((m = new RegExp(String.raw`\b(\d+)\s*${MINS}\b`, "i").exec(s))) {
    const minutes = Number(m[1]);
    return minutes > 0 && minutes <= 960 ? { minutes, matched: m[0] } : null;
  }
  if ((m = /\b(half an hour|half hour|aadha ghanta|adha ghanta)\b/i.exec(s))) return { minutes: 30, matched: m[0] };
  if ((m = /\b(an hour|one hour|ek ghanta|ek ghante)\b/i.exec(s))) return { minutes: 60, matched: m[0] };
  return null;
}

const LEADING = /^(?:i\s+)?(?:have\s+)?(?:spent|spend|worked|work|did|done|put in|logged|log|just|aaj|today|yesterday|kal)\b\s*/i;
const FILL = /\b(on|in|at|for|to|of|the|a|an|my|pe|par|ka|ke|ki|mein|me|kaam|kiya|kar|liya|kari|ho gaya|working|doing)\b/gi;

/** Reads a record of time already spent. null = this is not one (so the line is captured as usual). */
export function parseLogged(text: string, now: Date, data?: AppData): LoggedTime | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 160) return null;
  const verb = /^(?:i\s+)?(?:have\s+)?(?:spent|spend|worked|did|done|put in|logged)\b/i.test(raw) || /^(?:aaj|today|yesterday|kal)\s+(?:i\s+)?(?:spent|worked|did)\b/i.test(raw);
  const hindi = /\bghant(?:e|a|ay)\b|\bghnte\b/i.test(raw) && /\b(kiya|kar liya|kari|ho gaya|kaam)\b/i.test(raw);
  const dur = durationOf(raw);
  if (!dur) return null;
  // "2h app build": the duration comes first. (Not "2 pm", and not a plan for later.)
  const durationFirst = new RegExp(String.raw`^(?:(?:aaj|today|yesterday|kal)\s+)?(?:\d+(?:[.,]\d+)?\s*(?:${HOURS}|${MINS})|\d+h\d{1,2})\b`, "i").test(raw);
  if (!verb && !hindi && !durationFirst) return null;
  if (FUTURE.test(raw.replace(dur.matched, " "))) return null;

  const yesterday = /\b(yesterday|kal)\b/i.test(raw) && (verb || hindi || /\byesterday\b/i.test(raw));
  if (/\b(tomorrow|tmrw)\b/i.test(raw)) return null;

  let title = raw.replace(dur.matched, " ").replace(/\b(yesterday|today|aaj|kal)\b/gi, " ");
  title = title.replace(LEADING, "").replace(LEADING, "");
  title = title.replace(FILL, " ").replace(/[.,!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) title = "Work";
  title = title[0].toUpperCase() + title.slice(1);

  const date = toISO(yesterday ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now);
  const out: LoggedTime = { minutes: dur.minutes, title: title.slice(0, 80), sub: guessSub(title), date };

  // A tracked area named in the words: that is a session of it, not Other.
  if (data) {
    const lower = title.toLowerCase();
    const area = withDefaults(data.profile).areas.find((a) => a.target && (lower.includes(a.id.toLowerCase()) || lower.includes(a.name.toLowerCase()) || (a.id === "powerbi" && /power\s?bi/.test(lower)) || (a.id === "walking" && /\b(walk|walking)\b/.test(lower)) || (a.id === "meditation" && /\bmeditat/.test(lower))));
    if (area) out.areaId = area.id;
  }
  return out;
}

export const toWorkLog = (l: LoggedTime, now: Date = new Date()): WorkLog => ({ id: crypto.randomUUID(), date: l.date, minutes: l.minutes, title: l.title, sub: l.sub, at: now.getTime() });
