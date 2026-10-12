import { addDays, toISO } from "./dates";
import { snapshotOf } from "./weekly";
import { weekStart } from "./stats";
import type { AppData, HistoryEvent, ISODate, WeekSnapshot } from "./types";

/**
 * History compaction. The raw history log (every done / skipped / missed / rescheduled, forever) used to grow to tens of
 * thousands of entries, and the whole log was written to storage on every tap. Now only the last 8 weeks stay raw. Older weeks are
 * rolled into their weekly snapshot (the numbers and the written review), and their raw entries are handed to the caller to be
 * written to a backup file, the only place they are kept.
 */
export const KEEP_WEEKS = 8;

const dayOf = (ms: number) => toISO(new Date(ms));
/** The week an event belongs to, the way the review counts it (a "missed" one by its day, the rest by when it happened). */
const weekOf = (e: HistoryEvent) => weekStart(e.kind === "missed" ? e.date : dayOf(e.at));

/** The Monday of the oldest week that stays raw. */
export const keepFrom = (today: ISODate): ISODate => addDays(weekStart(today), -7 * KEEP_WEEKS);

export interface Compacted {
  data: AppData;
  /** The raw entries that were taken out (to be written to a backup file BEFORE `data` is saved). */
  archived: HistoryEvent[];
}

/**
 * Splits the history at the 8-week line. Every old week that had entries gets its "Your week" snapshot first (if it has none),
 * so nothing is lost from the review screens. Pure.
 */
export function compactHistory(data: AppData, now: Date): Compacted {
  const today = toISO(now);
  const from = keepFrom(today);
  const all = data.history ?? [];
  const keep: HistoryEvent[] = [];
  const archived: HistoryEvent[] = [];
  for (const e of all) (weekOf(e) < from ? archived : keep).push(e);
  if (!archived.length) return { data, archived };

  const have = new Set((data.weeks ?? []).map((w) => `${w.week}|${w.kind}`));
  const oldWeeks = [...new Set(archived.map(weekOf))].sort();
  const snaps: WeekSnapshot[] = [];
  for (const w of oldWeeks) {
    // The snapshot is computed while the raw entries are still there.
    if (!have.has(`${w}|your-week`)) snaps.push(snapshotOf(data, w, "your-week", now));
  }
  const weeks = snaps.length ? [...(data.weeks ?? []), ...snaps].sort((a, b) => a.week.localeCompare(b.week)).slice(-60) : data.weeks;
  return { data: { ...data, history: keep, weeks }, archived };
}

/** The file the archived entries are written to: today-history-YYYY-MM-DD.json (it matches the backup folder's naming rule). */
export const historyArchiveName = (now: Date) => `today-history-${toISO(now)}.json`;

export const historyArchiveText = (archived: HistoryEvent[], now: Date) => JSON.stringify({ kind: "today-history-archive", archivedAt: now.toISOString(), count: archived.length, events: archived }, null, 1);
