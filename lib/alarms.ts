import { fromISO } from "./dates";
import type { AppData, Task } from "./types";

/**
 * Which timed reminders should be ringing right now. Pure, so the in-app ringer (components/AlarmRinger.tsx)
 * and the tests share it. A task rings at its own time ("11:55 PM"); snoozing pushes it to `remindAt`.
 * Quiet hours never apply: you picked the time yourself.
 */
export interface DueAlarm {
  /** Unique per ring: the same task rings again after a snooze. */
  key: string;
  taskId: string;
  title: string;
  /** When it was meant to ring (epoch ms). */
  at: number;
}

/** Snooze choices on the ringing screen, in minutes. */
export const SNOOZE_CHOICES = [5, 10, 60];
/** A reminder that is still unanswered this long after its time stops ringing (it's still on Today). */
export const RING_WINDOW_MS = 3 * 3600_000;

/** When the task's alarm rings next (or last rang), ignoring whether you've seen it. undefined = no timed reminder. */
export function ringTime(t: Task): number | undefined {
  if (!t.due || !t.dueTime) return undefined;
  const d = fromISO(t.due);
  const [h, m] = t.dueTime.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  const base = d.getTime();
  return t.remindAt && t.remindAt > base ? t.remindAt : base;
}

const live = (data: AppData) => (data.profile?.notify?.reminders === false ? [] : data.tasks.filter((t) => t.status === "open"));

/** Alarms whose time has come, that you haven't answered, oldest first. */
export function dueAlarms(data: AppData, now = Date.now()): DueAlarm[] {
  const out: DueAlarm[] = [];
  for (const t of live(data)) {
    const at = ringTime(t);
    if (at == null || at > now || now - at > RING_WINDOW_MS) continue;
    if ((t.alarmAck ?? 0) >= at) continue;
    out.push({ key: `${t.id}@${at}`, taskId: t.id, title: t.title, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The next alarm still in the future (epoch ms), so the ringer knows how long it can sleep. */
export function nextAlarmAt(data: AppData, now = Date.now()): number | undefined {
  let best: number | undefined;
  for (const t of live(data)) {
    const at = ringTime(t);
    if (at != null && at > now && (best == null || at < best)) best = at;
  }
  return best;
}
