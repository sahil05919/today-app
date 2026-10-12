import { applyOccTask, findTask, isOccId } from "./series";
import type { AppData, ISODate } from "./types";

/**
 * Moves tasks to other days without counting it as a snooze (the app did it to keep the evening light, or you accepted a plan).
 * A repeat's occurrence (seriesId@day) changes THIS occurrence only. Pure: returns the new data.
 */
export function applyMoves(data: AppData, moves: Array<{ taskId: string; to: ISODate; time?: string }>): AppData {
  let d = data;
  const by = new Map(moves.map((m) => [m.taskId, m]));
  for (const m of moves) {
    if (!isOccId(m.taskId) || d.tasks.some((t) => t.id === m.taskId)) continue;
    const t = findTask(d, m.taskId);
    if (t) d = applyOccTask(d, m.taskId, t, { ...t, due: m.to, dueTime: m.time, remindAt: undefined, slot: undefined, hideUntil: undefined });
  }
  return {
    ...d,
    tasks: d.tasks.map((t) => {
      const m = by.get(t.id);
      return m ? { ...t, due: m.to, dueTime: m.time, remindAt: undefined, slot: undefined, hideUntil: undefined } : t;
    }),
  };
}
