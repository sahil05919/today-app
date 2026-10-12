import type { HistoryEvent, Task } from "./types";

/**
 * The history log: an append-only record of what was done, skipped, missed and rescheduled, with when it happened and who
 * made it (you, or the app). The weekly review (lib/weekly.ts) is computed from it, so it can say "You added 5, finished 4"
 * and tell your own tasks from the sessions and reminders the app generates.
 */
export const MAX_HISTORY = 20_000;

export function newEvent(e: Omit<HistoryEvent, "id" | "at"> & { at?: number }): HistoryEvent {
  return { id: crypto.randomUUID(), at: e.at ?? Date.now(), ...e };
}

/** The history type of a task: a rescheduled session is still a session, a carried bill is still a bill. */
export function typeOfTask(t: Pick<Task, "origin">): HistoryEvent["type"] {
  const k = t.origin?.kind;
  return k === "session" ? "session" : k === "bill" ? "bill" : k === "chore" ? "routine" : "task";
}

/** The key an event is filed under: the same item always has the same key, so the latest event says where it stands. */
export function keyOfTask(t: Pick<Task, "id" | "origin">): string {
  return t.origin ? t.origin.key : t.id.includes("@") ? `occ:${t.id}` : `task:${t.id}`;
}

export function taskEvent(t: Task, kind: HistoryEvent["kind"], at: number, date: string, to?: HistoryEvent["to"]): HistoryEvent {
  return newEvent({ at, date, kind, type: typeOfTask(t), key: keyOfTask(t), title: t.title, area: t.area ?? t.countsFor, createdByMe: !t.generated, to });
}
