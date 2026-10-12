import { toISO } from "./dates";
import { withDefaults } from "./profile";
import type { ParsedCapture } from "./parse";
import { understand } from "./understand";
import type { AppData, ISODate } from "./types";

/**
 * The contract with the Gmail add-on and its nightly script (Google Apps Script, written separately). They talk to the app ONLY
 * through Google Calendar:
 *
 *  Calendar "Today – Inbox" (you create it once; the app finds it by name):
 *    TASK: <title>      the event's date is the due date. The notes may have these lines (all optional):
 *                         area: Job   ·   time: 14:00   ·   duration: 20   ·   important: yes   ·   source: <email subject>
 *                       The app imports each one ONCE as a normal task, remembers the event id, and deletes the event from the Inbox.
 *    DIGEST: <title>    on today's date at 20:00. The notes have one email per line:  • Sender — Subject — reason
 *                       The app shows an "Emails that need you" card from 19:00. It never deletes digests (the script cleans up).
 *
 *  Events the add-on adds to your MAIN calendar (shifts, bookings) carry  #today-remind  in their notes: they get the same
 *  treatment as an event shared from Gmail (reminders 2 days before 19:00, the evening before 21:00, 1 hour before; a clash
 *  check against work hours; the day re-plans around them).
 */
export const TASK_PREFIX = "TASK:";
export const DIGEST_PREFIX = "DIGEST:";
export { REMIND_TAG } from "./calendarNames";
/** The digest card (and its line in the evening check-in) appears from this time. */
export const DIGEST_FROM = "19:00";

export interface InboxEvent {
  /** The phone's id of the event (to import it once). */
  eventId: number;
  title: string;
  description?: string;
  /** The event's day (local date for a timed one, the UTC date for an all-day one). */
  date: ISODate;
}

export interface InboxTask {
  eventId: number;
  title: string;
  due: ISODate;
  area?: string;
  time?: string;
  duration?: number;
  important: boolean;
  source?: string;
}

const lines = (s?: string) => (s ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim());

/** key: value lines (case-insensitive keys; anything else in the notes is ignored). */
export function noteFields(description?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines(description)) {
    const m = /^([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.+)$/.exec(l);
    if (m) out[m[1].toLowerCase().trim()] = m[2].trim();
  }
  return out;
}

const startsWith = (title: string, prefix: string) => title.trim().toUpperCase().startsWith(prefix);
const rest = (title: string, prefix: string) => title.trim().slice(prefix.length).trim();

/** The area the add-on named, if it is one of yours (by id or name); otherwise undefined and the normal classifier decides. */
function areaFrom(data: AppData, name?: string): string | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().trim();
  return withDefaults(data.profile).areas.find((a) => a.id.toLowerCase() === n || a.name.toLowerCase() === n)?.id;
}

/** A TASK: event → the task it describes, or null when it is not one (or has no title). */
export function parseTaskEvent(e: InboxEvent, data: AppData): InboxTask | null {
  if (!startsWith(e.title, TASK_PREFIX)) return null;
  const title = rest(e.title, TASK_PREFIX);
  if (!title) return null;
  const f = noteFields(e.description);
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(f.time ?? "");
  const duration = Number.parseInt(f.duration ?? "", 10);
  return {
    eventId: e.eventId,
    title: title.slice(0, 200),
    due: e.date,
    area: areaFrom(data, f.area),
    time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
    duration: Number.isFinite(duration) && duration > 0 && duration <= 600 ? duration : undefined,
    important: /^(yes|y|true|1|high)$/i.test(f.important ?? ""),
    source: f.source?.slice(0, 200),
  };
}

/** The capture the task becomes: the usual classifier fills what the add-on left out (the area, a sensible time of day). */
export function captureFor(t: InboxTask, data: AppData, now: Date): ParsedCapture {
  const guess = understand(t.title, data, now);
  const timed = !!t.time;
  return {
    ...guess,
    kind: "task",
    title: t.title,
    due: t.due,
    dueTime: timed ? t.time : undefined,
    timeSource: timed ? "typed" : undefined,
    area: t.area ?? guess.area,
    areaSource: t.area ? "explicit" : guess.areaSource,
    important: t.important || guess.important,
    estimateMin: t.duration ?? guess.estimateMin,
    notes: t.source ? `From Gmail: ${t.source}` : guess.notes,
    recur: undefined,
  };
}

export interface Digest {
  date: ISODate;
  /** "3 emails need you" */
  title: string;
  /** "Sender — Subject — reason", one per email. */
  items: string[];
}

/** A DIGEST: event → its list. Items are the lines that start with a bullet ("•", "-", "*"). */
export function parseDigest(e: InboxEvent): Digest | null {
  if (!startsWith(e.title, DIGEST_PREFIX)) return null;
  const items = lines(e.description)
    .map((l) => /^[•\-*·]\s*(.+)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => !!x)
    .slice(0, 30);
  const title = rest(e.title, DIGEST_PREFIX) || `${items.length} emails need you`;
  return { date: e.date, title: title.slice(0, 120), items };
}

/** Of all the DIGEST events read, the one for today (the latest if the script wrote two). Only today's digest is ever shown. */
export function todaysDigest(events: InboxEvent[], today: ISODate): Digest | null {
  const mine = events.map(parseDigest).filter((d): d is Digest => !!d && d.date === today);
  return mine.length ? mine[mine.length - 1] : null;
}

const minOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The card: from 19:00, today's digest only, until it is dismissed. */
export function digestCard(data: AppData, now: Date): Digest | null {
  const d = data.settings.digest;
  const today = toISO(now);
  if (!d || d.date !== today || data.settings.digestDismissed === today || !d.items.length) return null;
  return now.getHours() * 60 + now.getMinutes() >= minOf(DIGEST_FROM) ? d : null;
}

/** For the 20:00 check-in: "3 emails need you" (the digest's own count), or null when there is no digest for that day. */
export function digestLine(data: AppData, day: ISODate): string | null {
  const d = data.settings.digest;
  if (!d || d.date !== day || data.settings.digestDismissed === day || !d.items.length) return null;
  return d.items.length === 1 ? "1 email needs you" : `${d.items.length} emails need you`;
}

/** "1 task added from Gmail" / "3 tasks added from Gmail". */
export const addedLine = (n: number) => `${n} ${n === 1 ? "task" : "tasks"} added from Gmail`;
