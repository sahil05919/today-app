import { diffDays, toISO } from "./dates";
import type { ISODate, Task } from "./types";

/** Open tasks worth a gentle "how's it going?": overdue, due within 2 days, focused, or already started. */
export function checkInCandidates(tasks: Task[], today: ISODate): Task[] {
  return tasks
    .filter((t) => {
      if (t.status !== "open") return false;
      if (toISO(new Date(t.createdAt)) === today) return false; // just captured, no need to ask
      if (t.lastCheckIn?.date === today) return false;
      const dueSoon = t.due != null && diffDays(t.due, today) <= 2;
      const started = t.due != null && diffDays(t.due, today) <= 7 && t.steps.some((s) => s.done);
      return dueSoon || started || t.focus;
    })
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, 6);
}
