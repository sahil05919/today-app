import { addDays, diffDays, fromISO, toISO } from "../dates";
import { priorityScore } from "../rescue";
import { stepProgress } from "../estimate";
import { toMin, toHHMM, withDefaults } from "../profile";
import { backupDue } from "../backup";
import { billReminders, reminderText } from "../bills";
import { eventsOn } from "../fixed";
import { computeNudges } from "../nudges";
import { isOffDay } from "../offday";
import { eveningLine } from "../cheer";
import { behindAreaRows } from "../pileup";
import { briefFor, quoteMinute, tonightBody } from "../brief";
import { applyBudget } from "./budget";
import { plannedForDay } from "../schedule";
import { isQuoteDay, quoteForDate, quoteLine, quoteStateOf } from "../quoteBag";
import { actionable, buildTimeline } from "../timeline";
import { LOOKBACK_DAYS, withOccurrences } from "../series";
import { weekStart } from "../stats";
import { timerEndsAt } from "../timer";
import { choreKey, entryFor, wrapKey } from "../sessions";
import type { AppData, ISODate, Profile, Task } from "../types";

/**
 * Works out every notification the app should have scheduled, as plain data.
 * Pure and offline, so it's easy to test; `native.ts` turns the result into real Android notifications.
 */
/** "morning" is the brief, "tonight" the 20:00 check-in, "wrap" the end of day, "life" a life-admin item still open at 19:00, "eventprep" the lead-up to a shift or booking. */
export type NotifKind = "morning" | "checkin" | "wrap" | "reminder" | "slot" | "session" | "chore" | "nudge" | "event" | "bill" | "review" | "sofar" | "timer" | "quote" | "tonight" | "life" | "eventprep" | "dayDone";

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
  /** For session / chore / wrap: which one, e.g. "session:powerbi:2026-10-07". Used by Done / Snooze / Skip. */
  ref?: string;
  /** Show buttons: Done / On track / Snooze for tasks, Done / Snooze / Skip when `ref` is set. */
  actions: boolean;
  /** Needs a precise time (reminders, slots). Others can drift a few minutes. */
  exact: boolean;
  /** Rings like an alarm clock: loud alarm channel, Done / Snooze buttons, and a few follow-ups until you react. */
  alarm?: boolean;
  /** The running timer reached its goal: buttons are Done / +5 min. */
  timer?: boolean;
  /** How much it is worth when a day is over its notification budget (see ./budget): higher stays. */
  value?: number;
}

/** The rolling window: recomputed on start, on resume and after any change. */
export const DAYS_AHEAD = 14;
/** Android allows 500 scheduled alarms per app; stay well under. */
const MAX_NOTIFICATIONS = 320;
const MAX_CHECKINS_PER_DAY = 3;
/** An alarm that nobody reacts to rings again this many minutes later. */
export const NAG_AFTER_MIN = [5, 10, 15];

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

/** "Buy: milk, sugar, rice" from your shopping list (nothing is added to it for you). */
function groceryLine(data: AppData): string {
  const items = (data.grocery ?? []).filter((g) => !g.done).map((g) => g.name);
  if (!items.length) return "Nothing on your list yet.";
  return `Buy: ${items.slice(0, 8).join(", ")}${items.length > 8 ? ` +${items.length - 8} more` : ""}.`;
}

const friendlyWhen = (due: ISODate, today: ISODate) => {
  const diff = diffDays(due, today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const d = fromISO(due);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
};

export function planNotifications(raw: AppData, now: Date = new Date(), opts: { budget?: number } = {}): PlannedNotification[] {
  const today = toISO(now);
  // Repeats of the window come from getOccurrences, so the Vitamin has a 11:00 reminder on EVERY coming day.
  const data = withOccurrences(raw, addDays(today, -LOOKBACK_DAYS), addDays(today, DAYS_AHEAD + 7), today);
  const p = withDefaults(data.profile);
  const open = data.tasks.filter((t) => t.status === "open");
  const isWorkTask = (t: Task) => !!t.area && !!p.areas.find((a) => a.id === t.area)?.isWork;
  const out: PlannedNotification[] = [];

  /** `exactTime`: you chose this moment yourself ("11:55 PM"), so quiet hours and work hours never move it. */
  const push = (n: Omit<PlannedNotification, "id" | "at"> & { at: Date; work?: boolean; exactTime?: boolean }) => {
    // Judge "already passed" by the time it was meant for, before quiet hours / work hours shift it later.
    if (n.at.getTime() <= now.getTime() + 30_000) return;
    const { exactTime, work, ...rest } = n;
    out.push({ ...rest, at: exactTime ? new Date(n.at) : applyPolicy(n.at, !!work, p), id: hashId(n.key) });
  };

  const name = p.name || "friend";
  const quotes = quoteStateOf(data);
  const fill = (msg: string) => msg.replaceAll("{name}", name);

  /** A check-in that's been done or skipped is dropped; a snoozed one moves to when you asked. */
  const resolve = (key: string, normal: Date): Date | null => {
    const e = entryFor(data.log, key);
    if (!e) return normal;
    if (e.status === "snooze" && e.until && e.until > now.getTime()) return new Date(e.until);
    if (e.status === "snooze") return normal;
    return null;
  };

  // The day's timeline: what the screen shows, so a reminder never disagrees with it.
  const timelines = new Map<ISODate, ReturnType<typeof buildTimeline>>();
  const timelineOf = (day: ISODate) => {
    let tl = timelines.get(day);
    if (!tl) {
      tl = buildTimeline(data, day, day === today ? now : fromISO(day), { today });
      timelines.set(day, tl);
    }
    return tl;
  };

  // --- Session nudges: "Power BI session 14" at the planned start, ONLY for an area that is behind its weekly target ---------
  // The others stay silent: they are in the list, and a nudge for something that is on track is noise.
  const behind = new Map(behindAreaRows(data, today).map((r) => [r.id, r.gap]));
  for (let i = 0; i < DAYS_AHEAD && p.notify.sessionNudges !== false; i++) {
    const day = addDays(today, i);
    for (const it of timelineOf(day).items) {
      if (it.kind !== "session" || it.done || it.skipped || !it.sessionKey) continue;
      const area = p.areas.find((a) => a.id === it.areaId);
      if (!area?.target?.remind || !it.areaId || !behind.has(it.areaId)) continue;
      const when = resolve(it.sessionKey, at(day, toHHMM(it.start)));
      if (!when) continue;
      push({
        key: `session:${it.areaId}:${day}`,
        at: when,
        kind: "session",
        title: it.title,
        body: `${it.end - it.start} min · time to start, ${name}`,
        ref: it.sessionKey,
        actions: true,
        exact: true,
        // When a day has room for only one, the area furthest behind keeps it.
        value: 70 + Math.min(4, Math.round(behind.get(it.areaId) ?? 0)),
      });
    }
  }

  // --- Fixed events: a heads-up before they start --------------------------------
  const horizonDay = addDays(today, DAYS_AHEAD);
  if (p.notify.events) {
    for (const e of data.events ?? []) {
      if (!e.start || e.date < today || e.date > horizonDay) continue;
      push({
        key: `event:${e.id}`,
        at: new Date(at(e.date, e.start).getTime() - p.eventLeadMin * 60_000),
        kind: "event",
        title: e.title,
        body: `Starts at ${e.start}${p.eventLeadMin ? `, in ${p.eventLeadMin >= 60 && p.eventLeadMin % 60 === 0 ? `${p.eventLeadMin / 60} h` : `${p.eventLeadMin} min`}` : ""}`,
        actions: false,
        exact: true,
        exactTime: true,
      });
    }
  }

  // --- Bills and chores: "N days before", never for autopay ---------------------------
  if (p.notify.bills) {
    for (const r of billReminders(data, today, horizonDay)) {
      const when = resolve(r.key, at(r.date, r.bill.time));
      if (!when) continue;
      const list = r.bill.groceries ? groceryLine(data) : "";
      push({
        key: `bill:${r.bill.id}:${r.due}:${r.offset}`,
        at: when,
        kind: "bill",
        title: reminderText(r.bill, r.offset),
        body: [fill(r.bill.note), list].filter(Boolean).join(" "),
        ref: r.key,
        actions: true,
        exact: false,
      });
    }
  }

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = addDays(today, i);
    const dow = fromISO(day).getDay();
    const dayPlan = plannedForDay(data, day);
    const off = isOffDay(data, day);

    // --- The conscience: one gentle nudge a day (empty day, neglected area, behind target) ---
    if (p.notify.nudges && i < 2) {
      const top = computeNudges(data, i === 0 ? now : at(day, "12:00"))[0];
      // With nothing else to say, the two-weekly backup reminder uses the same slot.
      const text = top?.text ?? (backupDue(data, at(day, p.nudgeTime).getTime()) ? "It's been two weeks. Export a backup: Menu → Backup → Export JSON." : "");
      if (text) {
        push({ key: `nudge:${day}`, at: at(day, p.nudgeTime), kind: "nudge", title: top ? "A gentle nudge" : "Time for a backup", body: text, actions: false, exact: false });
      }
    }

    // --- A quote that makes him feel good: its own notification, daily, at a random moment between 11:00 and 16:00 ---
    // (English and Hinglish alternate, nothing repeats until the whole pool has been used, never in quiet hours.)
    if (p.notify.quote !== false && p.quoteEvery && isQuoteDay(quotes, day, p.quoteEvery)) {
      const q = quoteForDate(quotes, day, p.quoteEvery, today);
      const m = quoteMinute(data, day, p.quoteFrom, p.quoteTo);
      push({ key: `quote:${day}`, at: at(day, toHHMM(m)), kind: "quote", title: `A thought for you, ${name} 💛`, body: q.text, largeBody: quoteLine(q), actions: false, exact: true, exactTime: true });
    }

    // --- Sunday review: what got done, what slipped, plan next week ---------------------
    if (p.notify.review && dow === 0 && data.settings.reviewWeek !== weekStart(day)) {
      push({
        key: `review:${day}`,
        at: at(day, p.reviewTime),
        kind: "review",
        title: "Your week",
        body: `Your week is ready, ${name}: wins, what slipped, and a focus for next week.`,
        actions: false,
        exact: false,
      });
    }

    // --- Friday: "Week so far" (done / target, what is behind, light weekend catch-ups you can accept) ---
    if (p.notify.weekSoFar && dow === 5 && data.settings.sofarWeek !== weekStart(day)) {
      push({
        key: `sofar:${day}`,
        at: at(day, p.fridayReviewTime),
        kind: "sofar",
        title: "Week so far",
        body: `See where your week stands, ${name}. A light weekend can close any gap, if you want.`,
        actions: false,
        exact: false,
      });
    }

    // --- Daily rhythm: midday nudge, wrap up work, "Have you sorted your email?" ---
    for (const r of p.rhythm) {
      // On an off day the daily pings (midday, wrap up work, emails) stay quiet.
      if (off || !r.enabled || !r.days.includes(dow)) continue;
      const tracked = r.kind === "chore";
      const key = choreKey(r.id, day);
      const when = tracked ? resolve(key, at(day, r.time)) : at(day, r.time);
      if (!when) continue;
      push({
        key: `rhythm:${r.id}:${day}`,
        at: when,
        kind: tracked ? "chore" : "nudge",
        title: r.label,
        body: fill(r.message),
        ref: tracked ? key : undefined,
        actions: tracked,
        exact: false,
      });
    }

    // --- Morning brief 09:30: ONLY if the app has not been opened yet today (opening it IS the brief) -----------------
    // One line: today's must-dos and one focus. Nothing to say, nothing sent.
    if (p.notify.morning && !(day === today && data.settings.openedDate === today)) {
      const brief = briefFor(data, day, timelineOf(day), name, off);
      // work: true, so the 09:30 brief is not held until the end of the work shift like an ordinary ping.
      if (brief) push({ key: `morning:${day}`, at: at(day, p.briefTime), kind: "morning", title: brief.title, body: brief.body, actions: false, exact: false, work: true });
    }

    // --- Evening check-in 20:00: what is left tonight, and a nudge to share anything from email ------------------------
    if (p.notify.tonight !== false) {
      push({ key: `tonight:${day}`, at: at(day, p.checkinTime), kind: "tonight", title: "Tonight", body: tonightBody(timelineOf(day)), actions: false, exact: false });
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

    // --- End of day 22:00: only if something is still open. Tapping it opens a quick list: Done / Tomorrow / Not sure ---
    if (p.notify.wrap) {
      const tl = timelineOf(day);
      const openItems = [
        ...tl.items.filter((x) => actionable(x) && !x.done && !x.skipped && !x.fixed && ["task", "session", "chore"].includes(x.kind)),
        ...tl.overflow.map((o) => ({ title: o.task.title })),
      ];
      // A future day is judged by what is planned for it (it will be judged for real on the night).
      const has = day === today ? openItems.length > 0 : dayPlan.some((x) => !x.done) || open.some((t) => t.due === day && !t.dueTime);
      if (has) {
        const names = [...new Set(openItems.map((x) => x.title.replace(/ · session \d+$| session \d+$/, "")))].slice(0, 3).join(", ");
        push({ key: `wrap:${day}`, at: at(day, p.eveningWrap), kind: "wrap", title: "Tick or move what's left", body: names ? `Still open: ${names}.` : "A few things are still open.", actions: false, exact: false });
      }
    }
  }

  // --- Reminders at a task's scheduled time: they ring like an alarm clock ------------
  const horizon = addDays(today, DAYS_AHEAD);
  const alarm = (t: Task) => ({ title: t.title, taskId: t.id, actions: true, exact: true, alarm: true, exactTime: true, work: isWorkTask(t) });
  /** The same alarm again a few minutes later, until you react (Done, Snooze, or opening the task). */
  const pushNags = (t: Task, key: string, first: Date) => {
    if (t.alarmAck && t.alarmAck >= first.getTime()) return;
    // Follow-ups only make sense soon: a daily reminder two weeks out does not need three nags each.
    if (toISO(first) > addDays(today, 1)) return;
    NAG_AFTER_MIN.forEach((m, i) =>
      push({
        ...alarm(t),
        key: `${key}:nag${i + 1}`,
        at: new Date(first.getTime() + m * 60_000),
        kind: "reminder",
        title: `Still waiting: ${t.title}`,
        body: i === NAG_AFTER_MIN.length - 1 ? "Last reminder. Open Today to snooze or finish it." : "Tap Done, or snooze it for a while.",
      }),
    );
  };
  if (p.notify.reminders) {
    for (const t of open) {
      if (!t.due || !t.dueTime || t.due > horizon) continue;
      const first = at(t.due, t.dueTime);
      push({ ...alarm(t), key: `reminder:${t.id}`, at: first, kind: "reminder", body: "It's time." });
      // A reminder that has been snoozed is handled below; don't nag about the original time as well.
      if (!(t.remindAt && t.remindAt > first.getTime())) pushNags(t, `reminder:${t.id}`, first);
    }
  }

  // --- "Snooze" from an earlier notification --------------------------------
  for (const t of open) {
    if (!t.remindAt || t.remindAt <= now.getTime()) continue;
    const when = new Date(t.remindAt);
    if (t.dueTime) {
      // A task with its own time is an alarm: the snooze rings the same way.
      push({ ...alarm(t), key: `remind:${t.id}`, at: when, kind: "reminder", body: "Snoozed. It's time again." });
      pushNags(t, `remind:${t.id}`, when);
    } else {
      push({ key: `remind:${t.id}`, at: when, kind: "checkin", title: "Back to this?", body: t.title, taskId: t.id, actions: true, exact: false, work: isWorkTask(t), exactTime: true });
    }
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

  // --- The running timer: an exact alarm for the moment it runs out, so it rings with the screen locked ---------
  const tm = data.settings.timer;
  const tmEnd = tm ? timerEndsAt(tm) : null;
  if (tm && tmEnd) {
    const what = (tm.taskId ? data.tasks.find((t) => t.id === tm.taskId)?.title : tm.label) ?? "Your timer";
    push({
      key: `timer:${tm.startedAt}:${tm.goalMin}`,
      at: new Date(tmEnd),
      kind: "timer",
      title: `${what}: time's up`,
      body: `Well done, ${name}. Tap Done, or take 5 more minutes.`,
      actions: true,
      exact: true,
      exactTime: true,
      alarm: true,
      timer: true,
    });
  }

  // Few but worth it: at most five a day that do not have a fixed time of their own (see ./budget).
  return applyBudget(out, opts.budget)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_NOTIFICATIONS);
}

/** A short signature, so we only touch Android's alarms when something actually changed. */
export function signature(list: PlannedNotification[]): string {
  return list.map((n) => `${n.key}@${n.at.getTime()}#${n.title}|${n.body}`).join("\n");
}
