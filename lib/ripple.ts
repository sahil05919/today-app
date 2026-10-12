import { blockKey, dayRules, type BlockId, type Span } from "./busy";
import { weekdayShort } from "./dates";
import { toHHMM, withDefaults } from "./profile";
import { plannedForDay, planSessions } from "./schedule";
import { blockLogKey, entryFor } from "./sessions";
import type { AppData, BlockOverride, DayEntry, ISODate, Profile } from "./types";

/**
 * Routine blocks you can change: Work hours, Lunch, Commute, Tea & food break.
 *
 *   Just today   a tweak for one day (data.blocks). Everything else that day re-flows around it.
 *   Every day    changes the rhythm setting itself (Settings → Daily rhythm).
 *
 * Ripple: when a block runs longer, the evening starts later. Flexible things after it shift later with it (sessions,
 * tasks with no set time); FIXED things stay where they are (calendar events, tasks with a time you chose, bills). What no
 * longer fits before about 22:30 goes through the usual re-plan to the next day with room, and a one-line note says so.
 */
export const BLOCK_LABEL: Record<BlockId, string> = {
  work: "Work",
  "commute-to": "Commute",
  "commute-from": "Commute",
  lunch: "Lunch",
  tea: "Tea break",
};
export const BLOCK_TITLE: Record<BlockId, string> = {
  work: "Work hours",
  "commute-to": "Commute to work",
  "commute-from": "Commute home",
  lunch: "Lunch",
  tea: "Tea & food break",
};

export type Scope = "today" | "every";

/** Where a block is on a day right now (null: it isn't there that day, or you skipped it). */
export function blockSpan(data: AppData, id: BlockId, date: ISODate): Span | null {
  const r = dayRules(data, date);
  return id === "work" ? r.work : id === "commute-to" ? r.commuteTo : id === "commute-from" ? r.commuteFrom : id === "lunch" ? r.lunch : r.tea;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** The rhythm settings that "Every day" changes for a block. */
function profilePatch(data: AppData, id: BlockId, date: ISODate, start: number, min: number): Partial<Profile> {
  const office = dayRules(data, date).office;
  switch (id) {
    case "work":
      return { workStart: toHHMM(start), workEnd: toHHMM(start + min) };
    case "lunch":
      return { lunchStart: toHHMM(start), lunchMin: clamp(min, 0, 240) };
    case "tea":
      return { breakStart: toHHMM(start), breakEnd: toHHMM(start + Math.max(5, min)) };
    case "commute-to":
      return office ? { officeCommuteMin: clamp(min, 0, 240) } : { commuteToMin: clamp(min, 0, 240) };
    case "commute-from":
      return office ? { officeCommuteMin: clamp(min, 0, 240) } : { commuteFromMin: clamp(min, 0, 240) };
  }
}

/**
 * Changes a block. `start` / `min` are the block's new start (minutes after midnight) and length in minutes; leave one out
 * to keep it. "today" tweaks that day only; "every" updates the rhythm and clears today's own tweak so the setting shows.
 */
export function setBlock(data: AppData, id: BlockId, date: ISODate, edit: { start?: number; min?: number }, scope: Scope): AppData {
  const cur = blockSpan(data, id, date);
  if (!cur) return data;
  const start = clamp(edit.start ?? cur[0], 0, 1439);
  const min = clamp(edit.min ?? cur[1] - cur[0], 0, 1440);
  if (scope === "every") {
    const { [blockKey(id, date)]: _gone, ...rest } = data.blocks ?? {};
    void _gone;
    return { ...data, profile: { ...withDefaults(data.profile), ...profilePatch(data, id, date, start, min) }, blocks: rest };
  }
  const prev: BlockOverride = data.blocks?.[blockKey(id, date)] ?? {};
  const next: BlockOverride = { ...prev, skip: undefined, start: edit.start !== undefined ? start : prev.start, min: edit.min !== undefined ? min : prev.min };
  if (next.start === undefined) delete next.start;
  if (next.min === undefined) delete next.min;
  delete next.skip;
  return { ...data, blocks: { ...(data.blocks ?? {}), [blockKey(id, date)]: next } };
}

/** "Skip today": the block is not there that day (a commute on a day you work from home), and the time is free again. */
export function skipBlock(data: AppData, id: BlockId, date: ISODate, skip = true): AppData {
  const key = blockKey(id, date);
  const blocks = { ...(data.blocks ?? {}) };
  if (skip) blocks[key] = { ...(blocks[key] ?? {}), skip: true };
  else delete blocks[key];
  return { ...data, blocks };
}

/** Ticks a block off (or takes the tick back). */
export function tickBlock(data: AppData, id: BlockId, date: ISODate, done: boolean, now: number): AppData {
  const key = blockLogKey(id, date);
  const rest: DayEntry[] = (data.log ?? []).filter((e) => e.key !== key);
  return { ...data, log: done ? [...rest, { key, status: "done", at: now }] : rest };
}

export const blockDone = (data: AppData, id: BlockId, date: ISODate) => entryFor(data.log, blockLogKey(id, date))?.status === "done";

// ---- Telling you what moved ---------------------------------------------------------------------------------------------

const bare = (title: string) => title.replace(/ · session \d+$| session \d+$/, "");
const dayName = (d: ISODate) => weekdayShort(d);

/**
 * One line about what a change did to the day: "Commute +75 min → moved English Reading to Wed" when a session no longer
 * fits and moves to the next day with room, or "Commute +30 min → pushed Walking to 20:15" when things only shift later.
 * null when nothing that was planned changed.
 */
export function rippleNote(before: AppData, after: AppData, date: ISODate, label: string, deltaMin: number, now: Date): string | null {
  const open = (d: AppData) => plannedForDay(d, date).filter((s) => !s.done);
  const was = open(before);
  const is = open(after);
  const what = deltaMin ? `${label} ${deltaMin > 0 ? "+" : "−"}${Math.abs(deltaMin)} min` : label;
  const gone = was.filter((s) => !is.some((x) => x.areaId === s.areaId));
  if (gone.length) {
    const plan = planSessions(after, now).filter((s) => !s.done);
    const where = gone.map((s) => plan.find((x) => x.areaId === s.areaId && x.date > date)?.date);
    const first = where[0];
    const names = gone.length > 2 ? `${bare(gone[0].title)} and ${gone.length - 1} more` : gone.map((s) => bare(s.title)).join(" and ");
    const days = [...new Set(where.filter((d): d is ISODate => !!d).map(dayName))].join(" and ");
    return `${what} → moved ${names}${first ? ` to ${days}` : " to another day"}`;
  }
  const later = is.filter((x) => was.some((s) => s.areaId === x.areaId && x.start > s.start));
  if (later.length) return `${what} → pushed ${bare(later[0].title)}${later.length > 1 ? ` and ${later.length - 1} more` : ""} to ${toHHMM(later[0].start)}`;
  return null;
}
