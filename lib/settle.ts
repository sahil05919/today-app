import { addDays, fromISO, toISO } from "./dates";
import { buildTimeline } from "./timeline";
import type { AppData, ISODate, Task } from "./types";

/**
 * "Overflow moves to other days." Tasks due today that don't fit today's evening (see lib/timeline.ts) are moved to
 * the nearest day that has room for them. Carried-over (overdue) tasks never move away: they stay first in line.
 * Pure: returns the moves; `actions.moveTasks` applies them (without counting them as snoozes).
 */
export interface Move {
  taskId: string;
  title: string;
  from: ISODate;
  to: ISODate;
}

const DAYS_AHEAD = 7;

export function settleOverflow(data: AppData, now: Date = new Date()): Move[] {
  const today = toISO(now);
  const first = buildTimeline(data, today, now);
  const candidates = first.overflow.filter((o) => !o.carried).map((o) => o.task);
  if (!candidates.length) return [];

  const moves: Move[] = [];
  let work = data;
  for (const t of candidates) {
    for (let i = 1; i <= DAYS_AHEAD; i++) {
      const day = addDays(today, i);
      const trial: AppData = { ...work, tasks: work.tasks.map((x): Task => (x.id === t.id ? { ...x, due: day, dueTime: undefined } : x)) };
      // Judge the target day as it will be on that morning (nothing before "now" is lost).
      const tl = buildTimeline(trial, day, fromISO(day));
      if (!tl.overflow.some((o) => o.task.id === t.id)) {
        work = trial;
        moves.push({ taskId: t.id, title: t.title, from: today, to: day });
        break;
      }
    }
  }
  return moves;
}

/** "Moved Reply to Sam to Saturday to keep your evening light." (one line, however many moved) */
export function settleNote(moves: Move[]): string | null {
  if (!moves.length) return null;
  const day = (d: ISODate) => (d === addDays(toISO(new Date()), 1) ? "tomorrow" : fromISO(d).toLocaleDateString("en-GB", { weekday: "long" }));
  const first = moves[0];
  const more = moves.length > 1 ? ` and ${moves.length - 1} more` : "";
  return `Moved ${first.title}${more} to ${day(first.to)} to keep your evening light.`;
}
