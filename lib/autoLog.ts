import { addDays, toISO } from "./dates";
import { eventMarkKey } from "./fixed";
import { eventSource } from "./entries";
import { getOccurrences } from "./series";
import type { AppData, AutoEntry, FixedEvent, ISODate, ItemSource, Task } from "./types";

/**
 * "What the app did today": everything the app pulled in or moved by itself, so nothing slips in unseen.
 *
 *   added  a Gmail task / digest / shift, a new event in your phone calendar, a life-admin item that is on today
 *   moved  the planner re-planned (the evening was full, a session was missed and carried over, a clear command)
 *   pulled "Lighten my week" brought something forward
 *
 * It is a small append-only list (`data.auto`, the newest 500). The only thing that changes in an entry is `reviewed` (you looked at
 * it) and `removed` (you took it back). Things you type yourself, and your own repeats, are never in it. The history log keeps the
 * facts forever; this list is what the sheet shows (the last 7 days) and what the Home chip counts (unreviewed, the last 3 days).
 * Pure: the store applies these.
 */
export const MAX_AUTO = 500;
export const CHIP_DAYS = 3;
export const SHEET_DAYS = 7;

/** The sources that are the app's own doing. ("me" and "recurring" never appear here.) */
export const AUTO_SOURCES: ItemSource[] = ["gmail-star", "gmail-task", "gmail-shift", "gmail-interview", "gmail-bill", "gmail-booking", "gmail-digest", "phone-calendar", "planner-move", "planner-pull", "life-admin"];
const isAuto = (s: ItemSource) => AUTO_SOURCES.includes(s);

export type AutoGroup = "gmail" | "calendar" | "planner" | "life";
export const groupOfSource = (s: ItemSource): AutoGroup => (s.startsWith("gmail") ? "gmail" : s === "phone-calendar" ? "calendar" : s === "life-admin" ? "life" : "planner");
export const GROUP_TITLE: Record<AutoGroup, string> = { gmail: "From Gmail", calendar: "From your calendar", planner: "Planner moves", life: "Life admin" };

export type NewAuto = Omit<AutoEntry, "id" | "at" | "reviewed"> & { at?: number };

const day = (ms: number) => toISO(new Date(ms));

/** Adds entries (once per kind + item + day), newest last, capped. Returns the same data when nothing is new. */
export function appendAuto(data: AppData, list: NewAuto[], now: number = Date.now()): AppData {
  const cur = data.auto ?? [];
  const seen = new Set(cur.map((e) => `${e.kind}|${e.key}|${e.kind === "added" ? "" : (e.to?.date ?? e.date ?? "")}`));
  const fresh: AutoEntry[] = [];
  for (const n of list) {
    if (!isAuto(n.src)) continue;
    // An item is "added" once, ever; a move is one entry per destination day.
    const k = `${n.kind}|${n.key}|${n.kind === "added" ? "" : (n.to?.date ?? n.date ?? "")}`;
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push({ ...n, id: crypto.randomUUID(), at: n.at ?? now, reviewed: false });
  }
  return fresh.length ? { ...data, auto: [...cur, ...fresh].slice(-MAX_AUTO) } : data;
}

// ---- What changed -------------------------------------------------------------------------------------------------------------------------

/** The tasks (and repeat days) whose day or time changed between two versions of the data. */
export function dueChanges(prev: AppData, next: AppData): Array<{ key: string; title: string; from: { date: ISODate; time?: string }; to: { date: ISODate; time?: string } }> {
  const out: ReturnType<typeof dueChanges> = [];
  const before = new Map(prev.tasks.map((t) => [t.id, t]));
  for (const t of next.tasks) {
    const b = before.get(t.id);
    if (!b || !b.due || !t.due || t.status !== "open") continue;
    if (b.due !== t.due || (b.dueTime ?? "") !== (t.dueTime ?? "")) out.push({ key: `task:${t.id}`, title: t.title, from: { date: b.due, time: b.dueTime }, to: { date: t.due, time: t.dueTime } });
  }
  const was = new Map((prev.occurrences ?? []).map((r) => [r.key, r]));
  for (const r of next.occurrences ?? []) {
    if (!r.movedTo) continue;
    const b = was.get(r.key);
    if (b?.movedTo && b.movedTo.date === r.movedTo.date && (b.movedTo.time ?? "") === (r.movedTo.time ?? "")) continue;
    const s = (next.series ?? []).find((x) => x.id === r.seriesId);
    out.push({ key: `occ:${r.key}`, title: r.over?.title ?? s?.title ?? "Task", from: b?.movedTo ? { date: b.movedTo.date, time: b.movedTo.time } : { date: r.date, time: r.time ?? s?.time }, to: { date: r.movedTo.date, time: r.movedTo.time } });
  }
  return out;
}

/** The moves between two versions of the data as entries of one re-plan (they share a group). */
export function movesBetween(prev: AppData, next: AppData, src: "planner-move" | "planner-pull", group: string, kind: "moved" | "pulled" = "moved"): NewAuto[] {
  return dueChanges(prev, next).map((c) => ({ src, kind, key: c.key, title: c.title, date: c.to.date, from: c.from, to: c.to, group }));
}

/** Tasks the app made by itself since `prev` (a missed session carried over): they appear on a later day. */
export function carriedBetween(prev: AppData, next: AppData, group: string): NewAuto[] {
  const had = new Set(prev.tasks.map((t) => t.id));
  return next.tasks
    .filter((t: Task) => !had.has(t.id) && t.origin?.carried && t.status === "open")
    .map((t) => ({ src: "planner-move" as const, kind: "moved" as const, key: `task:${t.id}`, title: t.title, date: t.due, to: t.due ? { date: t.due, time: t.dueTime } : undefined, group }));
}

/**
 * Events that turned up in the phone's calendar since the last look. The first read ever only fills the "seen" list (an old calendar
 * must not flood the sheet); after that a new event from today to a month ahead is listed. Gmail shifts and bookings (#today-remind) are
 * labelled as such. `seen` is kept for the next call.
 */
export function newCalendarEntries(seen: string[] | undefined, events: FixedEvent[], today: ISODate): { entries: NewAuto[]; seen: string[] } {
  const keys = events.map(eventMarkKey);
  const merged = [...new Set([...(seen ?? []), ...keys])].slice(-1500);
  if (seen === undefined) return { entries: [], seen: merged };
  const had = new Set(seen);
  const horizon = addDays(today, 30);
  const entries: NewAuto[] = events
    .filter((e) => !had.has(eventMarkKey(e)) && e.date >= today && e.date <= horizon)
    .map((e) => ({ src: eventSource(e) === "me" ? ("phone-calendar" as const) : eventSource(e), kind: "added" as const, key: `event:${eventMarkKey(e)}`, title: e.title, date: e.date }));
  return { entries, seen: merged };
}

/** Life-admin items (laundry, haircut…) that are on today: listed once, the first time the app sees them on their day. */
export function lifeAdminToday(data: AppData, today: ISODate): NewAuto[] {
  return getOccurrences(data, today, today, today)
    .filter((o) => o.series.lifeId && o.on === today && o.status === "open" && !o.carried)
    .map((o) => ({ src: "life-admin" as const, kind: "added" as const, key: `occ:${o.key}`, title: o.task.title, date: today }));
}

/** A DIGEST: from the Gmail script, listed once. */
export function digestEntry(data: AppData): NewAuto | null {
  const d = data.settings.digest;
  if (!d || !d.items.length || data.settings.digestLogged === d.date) return null;
  return { src: "gmail-digest", kind: "added", key: `digest:${d.date}`, title: d.title, date: d.date };
}

// ---- Reading the list ---------------------------------------------------------------------------------------------------------------------

/** One line of the sheet: a single entry, or the moves of one re-plan folded together. */
export interface AutoRow {
  id: string;
  group: AutoGroup;
  entries: AutoEntry[];
  /** More than one move from the same re-plan. */
  folded: boolean;
  at: number;
  unreviewed: boolean;
}

/** Entries not taken back and not older than `days`. */
export function recentAuto(data: AppData, now: Date, days: number): AutoEntry[] {
  const from = addDays(toISO(now), -(days - 1));
  return (data.auto ?? []).filter((e) => !e.removed && day(e.at) >= from);
}

/** Rows for the sheet: the last 7 days, several moves of one re-plan folded into one row, newest first. */
export function autoRows(data: AppData, now: Date, days = SHEET_DAYS): AutoRow[] {
  const rows: AutoRow[] = [];
  const byGroup = new Map<string, AutoRow>();
  for (const e of recentAuto(data, now, days)) {
    const g = groupOfSource(e.src);
    if (e.group && e.kind !== "added") {
      const k = `${e.group}|${e.src}`;
      const row = byGroup.get(k);
      if (row) {
        row.entries.push(e);
        row.folded = true;
        row.at = Math.max(row.at, e.at);
        row.unreviewed ||= !e.reviewed;
        continue;
      }
      const fresh: AutoRow = { id: k, group: g, entries: [e], folded: false, at: e.at, unreviewed: !e.reviewed };
      byGroup.set(k, fresh);
      rows.push(fresh);
    } else rows.push({ id: e.id, group: g, entries: [e], folded: false, at: e.at, unreviewed: !e.reviewed });
  }
  return rows.sort((a, b) => b.at - a.at);
}

/** "🤖 App added 4 today": rows (a folded re-plan is one) that are still unreviewed, from the last 3 days. */
export const chipCount = (data: AppData, now: Date): number => autoRows(data, now, CHIP_DAYS).filter((r) => r.unreviewed).length;

/** The 20:00 check-in's extra line, or null. Counts what was added today and not yet looked at. */
export function checkinLine(data: AppData, today: ISODate): string | null {
  const n = autoRows(data, new Date(`${today}T12:00:00`), 1).filter((r) => r.unreviewed && day(r.at) === today).length;
  return n > 0 ? `The app added ${n} ${n === 1 ? "thing" : "things"} today — have a look.` : null;
}

/** What the text of one row says. */
export function rowText(r: AutoRow): string {
  if (r.folded) return `Re-planned: moved ${r.entries.length} items`;
  const e = r.entries[0];
  if (e.kind === "moved" || e.kind === "pulled") {
    const dest = e.to ? ` → ${e.to.date}${e.to.time ? ` ${e.to.time}` : ""}` : "";
    return `${e.kind === "pulled" ? "Pulled forward" : "Moved"}: ${e.title}${dest}`;
  }
  const label: Partial<Record<ItemSource, string>> = {
    "gmail-star": "Starred email",
    "gmail-task": "Task from Gmail",
    "gmail-shift": "Shift from Gmail",
    "gmail-interview": "Interview from Gmail",
    "gmail-bill": "Bill from Gmail",
    "gmail-booking": "Booking from Gmail",
    "gmail-digest": "Emails that need you",
    "phone-calendar": "New in your calendar",
    "life-admin": "Life admin today",
  };
  return `${label[e.src] ?? "Added"}: ${e.title}`;
}

// ---- Changing the list (pure: the store commits the result) -------------------------------------------------------------------------------

export const markSeen = (data: AppData, ids: string[]): AppData => {
  const s = new Set(ids);
  return data.auto?.some((e) => s.has(e.id) && !e.reviewed) ? { ...data, auto: data.auto.map((e) => (s.has(e.id) ? { ...e, reviewed: true } : e)) } : data;
};

export const markAllSeen = (data: AppData, now: Date): AppData => markSeen(data, recentAuto(data, now, SHEET_DAYS).filter((e) => !e.reviewed).map((e) => e.id));

export const markRemoved = (data: AppData, ids: string[]): AppData => {
  const s = new Set(ids);
  return { ...data, auto: (data.auto ?? []).map((e) => (s.has(e.id) ? { ...e, removed: true, reviewed: true } : e)) };
};

/** An entry's item, as the Open button needs it. */
export const itemOf = (e: AutoEntry): { kind: "task" | "occ" | "event" | "digest"; id: string } | null => {
  const [k, ...rest] = e.key.split(":");
  const id = rest.join(":");
  return k === "task" || k === "occ" || k === "event" || k === "digest" ? { kind: k, id } : null;
};
