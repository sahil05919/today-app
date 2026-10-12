import { MIRROR_NOTE } from "./calendarNames";
import { addDays, fromISO } from "./dates";
import { cached } from "./memo";
import type { MirrorEntry, MirrorEvent, MirrorOp, MirrorState } from "./nativeBridge";
import { withDefaults } from "./profile";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, ISODate } from "./types";

/**
 * "Today – Plan": a safety copy of the schedule in Google Calendar, so a crash or an uninstall never loses the plan.
 * This file is the pure part: what the calendar should contain (`buildMirrorEntries`) and what to change to get there (`diffMirror`).
 * lib/mirrorRun.ts talks to the phone.
 *
 *  - the next 7 days: sessions, tasks, life admin, bills / chores, events typed here. NOT routine blocks (commute, lunch, tea),
 *    the daily rhythm pings, or events that came from the phone's calendar (they are already there)
 *  - "emoji title" ("📊 Power BI session 4"); done = "✓ …", skipped = "✗ …"
 *  - timed items keep their time; flexible to-dos become all-day "To-do: …"
 *  - diff-based: insert the new, update the changed, delete the removed. Never "delete all and recreate"
 *  - a day that has ended is written once with its final ✓ / ✗ and then never touched again
 */
export const WINDOW_DAYS = 7;
/** The stored plan (for the 06:00 alarm) reaches this far, so the window can roll forward with the app closed. */
export const PLAN_DAYS = 14;
const DAY = 86_400_000;

/** A short stable fingerprint of the content, so "changed?" is one string compare. */
export function sigOf(e: MirrorEvent): string {
  const s = [e.title, e.start, e.end, e.allDay ? 1 : 0, e.description].join("␟");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${s.length}`;
}

const mirrored = (it: TLItem) => !it.muted && (it.kind === "task" || it.kind === "session" || it.kind === "bill" || (it.kind === "event" && !it.fromCalendar));

const stateMark = (it: TLItem) => (it.done ? "✓ " : it.skipped ? "✗ " : "");

function eventFor(data: AppData, day: ISODate, it: TLItem): MirrorEvent {
  const p = withDefaults(data.profile);
  const area = p.areas.find((a) => a.id === it.areaId);
  const emoji = it.emoji ?? area?.emoji;
  const [y, m, d] = day.split("-").map(Number);
  // Sessions and anything with its own time keep it; the rest (flexible to-dos, bills) are all-day.
  const timed = !it.allDay && (it.kind === "session" || it.fixed);
  const mins = Math.max(1, it.end - it.start);
  const lines = [area ? `Area: ${area.name}` : "", `Duration: ${it.allDay ? "all day" : `${mins} min`}`, MIRROR_NOTE].filter(Boolean);
  const description = lines.join("\n");
  const label = `${emoji ? `${emoji} ` : ""}${it.title}`;
  if (!timed) {
    const start = Date.UTC(y, m - 1, d);
    return { title: `${stateMark(it)}To-do: ${label}`, start, end: start + DAY, allDay: true, description };
  }
  const base = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const start = base + Math.min(it.start, 1438) * 60_000;
  const end = base + Math.min(Math.max(it.end, it.start + 5), 1439) * 60_000;
  return { title: `${stateMark(it)}${label}`, start, end, allDay: false, description };
}

/** Everything the calendar should hold for `from`..`from + days - 1`. Past days (before `today`) carry their final state. */
export function buildMirrorEntries(data: AppData, from: ISODate, days: number, now: Date): MirrorEntry[] {
  return cached(data, `mirror:${from}:${days}:${Math.floor(now.getTime() / 60_000)}`, () => {
    const out: MirrorEntry[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const tl = buildTimeline(data, day, now);
      const seen = new Set<string>();
      for (const it of tl.items) {
        if (!mirrored(it)) continue;
        // An event typed here that was also written to the phone calendar is already in Google: not twice.
        if (it.kind === "event") {
          const e = (data.events ?? []).find((x) => x.id === it.eventId);
          if (!e || e.calEventId || e.source) continue;
        }
        const key = `${day}|${it.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const event = eventFor(data, day, it);
        out.push({ key, day, sig: sigOf(event), event });
      }
    }
    return out;
  });
}

export interface MirrorDiff {
  ops: MirrorOp[];
  inserts: number;
  updates: number;
  deletes: number;
  finals: number;
}

/**
 * What to change so the calendar matches `desired`. `desired` covers the days from the oldest unfinished past day through the window.
 * - today and later: insert new keys, update changed ones, delete keys that are gone from the window (and only those in the window)
 * - before today: a mirrored entry that is not yet final is written once with its final state and marked final; one that is already
 *   final is never touched; a past day is never created
 */
export function diffMirror(desired: MirrorEntry[], map: MirrorState["map"], today: ISODate): MirrorDiff {
  const ops: MirrorOp[] = [];
  const last = addDays(today, WINDOW_DAYS - 1);
  const want = new Map(desired.map((e) => [e.key, e]));
  let inserts = 0;
  let updates = 0;
  let deletes = 0;
  let finals = 0;

  for (const e of desired) {
    const have = map[e.key];
    if (e.day < today) {
      if (!have || have.final) continue;
      ops.push({ op: "update", key: e.key, day: e.day, sig: e.sig, event: have.sig === e.sig ? undefined : e.event, final: true });
      finals++;
      continue;
    }
    if (e.day > last) continue;
    if (!have) {
      ops.push({ op: "insert", key: e.key, day: e.day, sig: e.sig, event: e.event });
      inserts++;
    } else if (have.sig !== e.sig) {
      ops.push({ op: "update", key: e.key, day: e.day, sig: e.sig, event: e.event });
      updates++;
    }
  }
  for (const [key, have] of Object.entries(map)) {
    if (have.final || (want.has(key) && have.day <= last)) continue;
    if (have.day >= today) {
      ops.push({ op: "delete", key, day: have.day, sig: have.sig });
      deletes++;
    } else {
      // A past entry the plan no longer shows: its day is over, so it is closed as it stands.
      ops.push({ op: "update", key, day: have.day, sig: have.sig, final: true });
      finals++;
    }
  }
  return { ops, inserts, updates, deletes, finals };
}

/** The oldest past day whose entries are not final yet (so the app finalises days it missed), at most 14 days back. */
export function oldestOpenDay(map: MirrorState["map"], today: ISODate): ISODate {
  let oldest = addDays(today, -1);
  const floor = addDays(today, -14);
  for (const v of Object.values(map)) if (!v.final && v.day < today && v.day < oldest) oldest = v.day;
  return oldest < floor ? floor : oldest;
}

export const dayCount = (a: ISODate, b: ISODate) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / DAY);
