import { addDays, diffDays, fromISO, toISO } from "../dates";
import { priorityScore } from "../rescue";
import { stepProgress } from "../estimate";
import { toMin, withDefaults } from "../profile";
import type { AppData, ISODate, Profile, Task } from "../types";

/**
 * Works out every notification the app should have scheduled, as plain data.
 * Pure and offline, so it's easy to test; `native.ts` turns the result into real Android notifications.
 */
export type NotifKind = "morning" | "checkin" | "wrap" | "reminder" | "slot";

export interface PlannedNotification {
  /** Stable key, e.g. "morning:2026-10-07". Same key = same notification across reschedules. */
  key: string;
  /** Numeric id derived from the key (Android needs an int). */
  id: number;
  at: Date;
  kind: NotifKind;
  title: string;
  /** One-line version. */
  body: string;
  /** Expanded version, when different. */
  largeBody?: string;
  taskId?: string;
  /** Show Done / On track / Snooze buttons. */
  actions: boolean;
  /** Needs a precise time (reminders, slots). Others can drift a few minutes. */
  exact: boolean;
}

const DAYS_AHEAD = 7;
const MAX_NOTIFICATIONS = 60;
const MAX_CHECKINS_PER_DAY = 3;

export function hashId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2_000_000_000 || 1;
}

const at = (date: ISODate, hhmm: string): Date => {
  const d = fromISO(date);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
};
const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

function inQuiet(m: number, p: Profile): boolean {
  const qs = toMin(p.quietStart);
  const qe = toMin(p.quietEnd);
  if (qs === qe) return false;
  return qs > qe ? m >= qs || m < qe : m >= qs && m < qe;
}

function inWorkShift(d: Date, p: Profile): boolean {
  if (!p.workDays.includes(d.getDay())) return false;
  const m = minOfDay(d);
  if (m < toMin(p.workStart) || m >= toMin(p.workEnd)) return false;
  // Lunch is a break, so pings are fine then.
  const ls = toMin(p.lunchStart);
  return !(p.lunchMin > 0 && m >= ls && m < ls + p.lunchMin);
}

/**
 * Pushes a notification time out of quiet hours and (unless it's a work task) out of the work shift.
 * Returns a time that is allowed.
 */
export function applyPolicy(when: Date, isWork: boolean, p: Profile): Date {
  let d = new Date(when);
  for (let i = 0; i < 4; i++) {
    const m = minOfDay(d);
    if (inQuiet(m, p)) {
      const qe = toMin(p.quietEnd);
      const next = new Date(d);
      // After the quiet start (evening): the next morning. Before the quiet end (small hours): later today.
      if (m >= qe && toMin(p.quietStart) > qe) next.setDate(next.getDate() + 1);
      next.setHours(Math.floor(qe / 60), qe % 60, 0, 0);
      d = next;
      continue;
    }
    if (!isWork && inWorkShift(d, p)) {
      const we = toMin(p.workEnd);
      d = new Date(d);
      d.setHours(Math.floor(we / 60), we % 60, 0, 0);
      continue;
    }
    break;
  }
  return d;
}

const friendlyWhen = (due: ISODate, today: ISODate) => {
  const diff = diffDays(due, today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const d = fromISO(due);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
};

export function planNotifications(data: AppData, now: Date = new Date()): PlannedNotification[] {
  const p = withDefaults(data.profile);
  const today = toISO(now);
  const open = data.tasks.filter((t) => t.status === "open");
  const isWorkTask = (t: Task) => !!t.area && !!p.areas.find((a) => a.id === t.area)?.isWork;
  const out: PlannedNotification[] = [];

  const push = (n: Omit<PlannedNotification, "id" | "at"> & { at: Date; work?: boolean }) => {
    // Judge "already passed" by the time it was meant for, before quiet hours / work hours shift it later.
    if (n.at.getTime() <= now.getTime() + 30_000) return;
    out.push({ ...n, at: applyPolicy(n.at, !!n.work, p), id: hashId(n.key) });
  };

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = addDays(today, i);

    // --- Morning check-in: "3 things today" + what's due soon ---------------
    if (p.notify.morning) {
      const dueThatDay = open.filter((t) => t.due === day || (i === 0 && t.due != null && t.due < day));
      const picks =
        i === 0
          ? [...open.filter((t) => t.focus), ...dueThatDay.filter((t) => !t.focus)]
          : dueThatDay.sort((a, b) => priorityScore(b, day) - priorityScore(a, day));
      const top = picks.slice(0, 3);
      const soon = open
        .filter((t) => t.due && diffDays(t.due, day) >= 1 && diffDays(t.due, day) <= 2 && !top.includes(t))
        .slice(0, 2);
      if (top.length || soon.length) {
        const lines = top.map((t) => `• ${t.title}`);
        const soonLine = soon.length ? `Due soon: ${soon.map((t) => `${t.title} (${friendlyWhen(t.due!, day)})`).join(", ")}` : "";
        const title = top.length ? `${top.length} ${top.length === 1 ? "thing" : "things"} today` : "Nothing due today";
        push({
          key: `morning:${day}`,
          at: at(day, p.morningCheckIn),
          kind: "morning",
          title,
          body: top.length ? top.map((t) => t.title).join(" · ") : soonLine,
          largeBody: [...lines, soonLine].filter(Boolean).join("\n"),
          actions: false,
          exact: false,
        });
      }
    }

    // --- Task check-ins: "Due Friday, where are you?" -----------------------
    if (p.notify.taskCheckIns) {
      const candidates = open
        .filter((t) => t.due && t.lastCheckIn?.date !== day)
        .filter((t) => {
          const d = diffDays(t.due!, day);
          // The day before it's due, the day it's due, and overdue things on today only.
          return d === 1 || d === 0 || (i === 0 && d < 0);
        })
        .sort((a, b) => priorityScore(b, day) - priorityScore(a, day))
        .slice(0, MAX_CHECKINS_PER_DAY);
      candidates.forEach((t, k) => {
        const prog = stepProgress(t);
        const when = friendlyWhen(t.due!, day);
        push({
          key: `checkin:${t.id}:${day}`,
          at: new Date(at(day, p.taskCheckIn).getTime() + k * 2 * 60_000),
          kind: "checkin",
          title: when === "overdue" ? "Still on this?" : `Due ${when}, where are you?`,
          body: prog.total ? `${t.title} (${prog.done}/${prog.total} steps)` : t.title,
          taskId: t.id,
          actions: true,
          exact: false,
          work: isWorkTask(t),
        });
      });
    }

    // --- Evening wrap-up ----------------------------------------------------
    if (p.notify.wrap && open.length) {
      const left = i === 0 ? open.filter((t) => (t.due != null && t.due <= day) || t.focus).length : 0;
      push({
        key: `wrap:${day}`,
        at: at(day, p.eveningWrap),
        kind: "wrap",
        title: "Wrap up the day",
        body: left ? `${left} left. Roll them to tomorrow in one tap.` : "Take a minute to see how today went.",
        actions: false,
        exact: false,
      });
    }
  }

  // --- Reminders at a task's scheduled time ----------------------------------
  const horizon = addDays(today, DAYS_AHEAD);
  if (p.notify.reminders) {
    for (const t of open) {
      if (!t.due || !t.dueTime || t.due > horizon) continue;
      push({
        key: `reminder:${t.id}`,
        at: at(t.due, t.dueTime),
        kind: "reminder",
        title: t.title,
        body: "It's time.",
        taskId: t.id,
        actions: true,
        exact: true,
        work: isWorkTask(t),
      });
    }
  }

  // --- "Snooze 2h" from an earlier notification --------------------------------
  for (const t of open) {
    if (!t.remindAt || t.remindAt <= now.getTime()) continue;
    push({
      key: `remind:${t.id}`,
      at: new Date(t.remindAt),
      kind: "checkin",
      title: "Back to this?",
      body: t.title,
      taskId: t.id,
      actions: true,
      exact: false,
      work: isWorkTask(t),
    });
  }

  // --- Start of a slot from "Plan my day" ------------------------------------
  if (p.notify.slots) {
    for (const t of open) {
      if (!t.slot || t.slot.date < today || t.slot.date > horizon) continue;
      // Skip if a reminder already fires at that exact moment.
      if (p.notify.reminders && t.due === t.slot.date && t.dueTime === t.slot.start) continue;
      push({
        key: `slot:${t.id}:${t.slot.date}`,
        at: at(t.slot.date, t.slot.start),
        kind: "slot",
        title: `Now: ${t.title}`,
        body: `${t.slot.min} min block. You've got this.`,
        taskId: t.id,
        actions: true,
        exact: true,
        work: isWorkTask(t),
      });
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_NOTIFICATIONS);
}

/** A short signature, so we only touch Android's alarms when something actually changed. */
export function signature(list: PlannedNotification[]): string {
  return list.map((n) => `${n.key}@${n.at.getTime()}#${n.title}|${n.body}`).join("\n");
}
