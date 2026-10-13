import { LocalNotifications, type ActionPerformed } from "@capacitor/local-notifications";
import { createAlarmChannel } from "../nativeBridge";
import { setEarlyAlarm } from "../earlyAlarmRun";
import type { AlarmAction } from "../earlyAlarm";
import { toISO } from "../dates";
import { isNative } from "../platform";
import { findTask, parseOccKey } from "../series";
import { itemFromRef } from "../reschedule";
import { findTimelineItem } from "../tap";
import { logError } from "../debugLog";
import { safely, withTimeout } from "../nativeGuard";
import { actions, getData, whenLoaded } from "../store";
import { applyTimerAction } from "../timerRun";
import { hashId, planNotifications, signature, type NotifKind, type PlannedNotification } from "./plan";
import type { AppData } from "../types";

/**
 * The Android side of notifications. Everything is scheduled on the phone (AlarmManager via Capacitor),
 * so it works offline. We never keep anything "pending" that isn't derived from your data:
 * every change cancels what's scheduled and schedules the freshly planned set (see `rescheduleAll`).
 */
const CH_REMINDERS = "today-reminders"; // timed reminders and slots: pop up
const CH_GENTLE = "today-checkins"; //  morning, evening and task check-ins: quieter
/** Timed reminders: alarm sound at alarm volume, created natively (see TodayNativePlugin.createAlarmChannel). */
const CH_ALARM = "today-alarm";
const TASK_ACTIONS = "TASK";
const ALARM_ACTIONS = "ALARM";
const CHECKIN_ACTIONS = "CHECKIN";
/** The night-before reminder of an early start: one button, "Set alarm". */
const PREP_ACTIONS = "PREP";
const TIMER_ACTIONS = "TIMER";
/** The old Snooze buttons are Reschedule +1 hour now. */
export const RESCHEDULE_BUTTON = "+1 hour";

/** "+1 hour" on a notification is Reschedule, exactly as in the app. */
export function reschedulePlusHour(ref: string, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const own = ref.split(":").find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
  const found = findTimelineItem(getData(), ref, toISO(now), now);
  // Use the timeline's item when it is on the reminder's own day; otherwise rebuild it from the reference.
  const target = found && found.date === own ? { item: found.it, date: found.date } : itemFromRef(getData(), ref);
  if (target) actions.reschedule({ kind: "item", item: target.item, date: target.date }, { kind: "hour" }, now);
}

/**
 * Done / +1 hour / Skip on a session, chore, bill or end-of-day check-in.
 * `ref` is "session:<areaId>:<date>", "chore:<id>:<date>", "bill:<id>:<due>" or "wrap:<date>".
 * Done counts the session ("Power BI session 14"); +1 hour reschedules it (the end-of-day question just asks again);
 * Skip leaves it uncounted today.
 */
export function applyCheckInAction(actionId: string, ref: string, now = Date.now()) {
  const [kind, ...rest] = ref.split(":");
  const date = rest[rest.length - 1];
  if (actionId === "done") {
    if (kind === "session") {
      // Already counted? Then Done is a no-op, never an undo.
      const done = getData().sessions?.some((l) => l.areaId === rest[0] && l.date === date);
      if (!done) actions.addSession(rest[0], date, "checkin");
    } else if (kind === "wrap") actions.markDayDone(date);
    else if (kind === "bill") actions.completeBill(rest[0], date);
    else actions.setEntry(ref, "done");
  } else if (actionId === "skip") actions.setEntry(ref, "skip");
  else if (actionId === "snooze") {
    if (kind === "wrap") actions.setEntry(ref, "snooze", now + 60 * 60_000);
    else reschedulePlusHour(ref, now);
  }
}

export type PermissionState = "granted" | "denied" | "prompt";

export interface NotifStatus {
  supported: boolean;
  permission: PermissionState;
  /** Exact alarms (Android 12+). null when not applicable. */
  exact: PermissionState | null;
}

const norm = (s: string): PermissionState => (s === "granted" ? "granted" : s === "denied" ? "denied" : "prompt");

export async function getStatus(): Promise<NotifStatus> {
  if (!isNative()) return { supported: false, permission: "denied", exact: null };
  const [p, e] = await Promise.all([
    safely<{ display: string }>("checkPermissions", () => LocalNotifications.checkPermissions(), { display: "prompt" }),
    safely("checkExactNotificationSetting", () => LocalNotifications.checkExactNotificationSetting(), null),
  ]);
  return { supported: true, permission: norm(p.display), exact: e ? norm(e.exact_alarm) : null };
}

/** Android 13+ asks "Allow Today to send you notifications?" */
export async function requestPermission(): Promise<PermissionState> {
  if (!isNative()) return "denied";
  // The permission dialog waits for a tap, so it is given a minute rather than 5 seconds.
  const r = await safely<{ display: string }>("requestPermissions", () => LocalNotifications.requestPermissions(), { display: "denied" }, 60_000);
  return norm(r.display);
}

/** Opens Android's "Alarms & reminders" screen so exact reminders can be allowed. */
export async function openExactAlarmSettings(): Promise<PermissionState | null> {
  if (!isNative()) return null;
  const r = await safely("changeExactNotificationSetting", () => LocalNotifications.changeExactNotificationSetting(), null, 60_000);
  return r ? norm(r.exact_alarm) : null;
}

let initing: Promise<void> | null = null;
/** Creates the channels and the Done / On track / +1 hour buttons. Safe to call repeatedly (everyone waits for the same run). */
export function initNotifications(): Promise<void> {
  if (!isNative()) return Promise.resolve();
  return (initing ??= setUp().finally(() => {
    // A failed set-up is tried again next time; a good one is kept.
    if (!channelsReady) initing = null;
  }));
}
let channelsReady = false;
async function setUp() {
  try {
    // Alarm channel first: native code gives it the alarm sound. If that fails, a plain loud channel is the fallback.
    if (!(await createAlarmChannel(CH_ALARM))) {
      await withTimeout(LocalNotifications.createChannel({
        id: CH_ALARM,
        name: "Alarms",
        description: "Reminders you set for a specific time",
        importance: 5,
        visibility: 1,
        vibration: true,
      }), "createChannel(alarm)");
    }
    await withTimeout(LocalNotifications.createChannel({
      id: CH_REMINDERS,
      name: "Reminders",
      description: "Reminders at a task's time, and the start of your planned slots",
      importance: 4,
      visibility: 1,
      vibration: true,
    }), "createChannel(reminders)");
    await withTimeout(LocalNotifications.createChannel({
      id: CH_GENTLE,
      name: "Check-ins",
      description: "Morning plan, task check-ins and the evening wrap-up",
      importance: 3,
      visibility: 1,
      vibration: false,
    }), "createChannel(checkins)");
    // Android shows at most 3 buttons. "Behind" is what happens when you tap the notification itself.
    await withTimeout(LocalNotifications.registerActionTypes({
      types: [
        // A timed reminder behaves like a phone alarm: Done, or Reschedule +1 hour.
        {
          id: ALARM_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "snooze60", title: "↻ +1 hour" },
          ],
        },
        // The timer ran out: log it, or take five more minutes.
        {
          id: TIMER_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "extend", title: "+5 min" },
          ],
        },
        {
          id: TASK_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "ontrack", title: "On track" },
            { id: "snooze", title: "↻ +1 hour" },
          ],
        },
        // Sessions, chores ("Have you sorted your email?") and the end-of-day question.
        {
          id: PREP_ACTIONS,
          actions: [{ id: "setalarm", title: "⏰ Set alarm" }],
        },
        {
          id: CHECKIN_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "snooze", title: "↻ +1 hour" },
            { id: "skip", title: "Skip" },
          ],
        },
      ],
    }), "registerActionTypes");
    channelsReady = true;
  } catch (e) {
    logError("notifications:setup", e);
  }
}

const occOf = (taskId?: string) => {
  const o = taskId ? parseOccKey(taskId) : null;
  return o ? { id: o.seriesId, date: o.date } : undefined;
};

const toSchema = (n: PlannedNotification, exactAllowed: boolean) => ({
  id: n.id,
  title: n.title,
  body: n.body,
  largeBody: n.largeBody,
  schedule: { at: n.at, allowWhileIdle: true },
  channelId: n.alarm ? CH_ALARM : n.exact ? CH_REMINDERS : CH_GENTLE,
  actionTypeId: n.setAlarm ? PREP_ACTIONS : n.actions ? (n.timer ? TIMER_ACTIONS : n.alarm ? ALARM_ACTIONS : n.ref ? CHECKIN_ACTIONS : TASK_ACTIONS) : undefined,
  smallIcon: "ic_stat_today",
  autoCancel: true,
  // A repeat's notification says exactly which day it is for: { id: seriesId, date }, so a tap opens THAT occurrence.
  extra: { taskId: n.taskId, kind: n.kind, key: n.key, ref: n.ref, at: n.at.getTime(), occ: occOf(n.taskId), setAlarm: n.setAlarm },
  // Only ask for a precise alarm when it's already allowed, so rescheduling never throws up a settings screen.
  isExactNotification: n.exact && exactAllowed,
  isExactMandatory: false,
});

let lastSig = "";
let chain: Promise<unknown> = Promise.resolve();
/** Notifications that are not part of the plan (the "All done for today" one): a reschedule must not cancel them. */
const keep = new Set<number>();

/**
 * Cancels everything we scheduled and schedules what the data says should exist.
 * Skips the work when nothing changed. Calls are queued so they never overlap.
 */
export function rescheduleAll(data: AppData, opts: { force?: boolean } = {}): Promise<number> {
  const run = async (): Promise<number> => {
    if (!isNative()) return 0;
    await initNotifications();
    const status = await getStatus();
    if (status.permission !== "granted") return 0;

    const plan = planNotifications(data);
    const sig = signature(plan);
    if (sig === lastSig && !opts.force) return plan.length;

    try {
      const pending = await withTimeout(LocalNotifications.getPending(), "getPending");
      const stale = pending.notifications.filter((n) => !keep.has(n.id));
      if (stale.length) {
        await withTimeout(LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) }), "cancel");
      }
      if (plan.length) {
        const exact = status.exact === "granted";
        await withTimeout(LocalNotifications.schedule({ notifications: plan.map((n) => toSchema(n, exact)) }), "schedule", 15_000);
      }
      lastSig = sig;
    } catch (e) {
      logError("notifications:reschedule", e);
      lastSig = ""; // try again next time
    }
    return plan.length;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

/** The ids of everything Android has scheduled for this app right now (for the self-check). null when it cannot be read. */
export async function pendingIds(): Promise<number[] | null> {
  if (!isNative()) return null;
  try {
    return (await withTimeout(LocalNotifications.getPending(), "getPending")).notifications.map((n) => n.id);
  } catch (e) {
    logError("notifications:pendingIds", e);
    return null;
  }
}

/**
 * "All done for today 🎉": sent the moment the day's list is finished (the app calls it once a day). Not part of the plan,
 * so it is kept when the plan is rescheduled a moment later.
 */
export async function notifyDayDone(): Promise<boolean> {
  if (!isNative()) return false;
  await initNotifications();
  if ((await getStatus()).permission !== "granted") return false;
  const date = toISO(new Date());
  const id = hashId(`dayDone:${date}`);
  keep.add(id);
  await safely("schedule(dayDone)", () => LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: "All done for today 🎉",
        body: "Your evening is free. Pull something forward to lighten the week, or take it easy?",
        schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
        channelId: CH_REMINDERS,
        smallIcon: "ic_stat_today",
        autoCancel: true,
        extra: { kind: "dayDone", key: `dayDone:${date}`, at: Date.now() },
      },
    ],
  }), undefined);
  return true;
}

/** A notification 5 seconds from now, to check everything is wired up. */
export async function sendTest(): Promise<boolean> {
  if (!isNative()) return false;
  await initNotifications();
  if ((await getStatus()).permission !== "granted") return false;
  await safely("schedule(test)", () => LocalNotifications.schedule({
    notifications: [
      {
        id: 987654321,
        title: "It works 🎉",
        body: "Sahil's Today can reach you here. This is how your timed reminders will sound.",
        schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        channelId: CH_ALARM,
        smallIcon: "ic_stat_today",
      },
    ],
  }), undefined);
  return true;
}

/**
 * Buttons on a timed reminder. "done" finishes the task; "snooze10" / "snooze60" are Reschedule +1 hour (an alarm
 * that is moved rings again at its new time); "ack" just means you saw it. Returns false when it isn't an alarm one.
 */
export function applyAlarmAction(actionId: string, taskId: string, firedAt = Date.now(), now = Date.now()): boolean {
  if (!["done", "snooze10", "snooze60", "ack"].includes(actionId)) return false;
  const task = findTask(getData(), taskId);
  if (!task || task.status !== "open") return true; // already finished or deleted: nothing to do
  const ack = Math.max(firedAt, now);
  if (actionId === "done") actions.toggleDone(taskId);
  else if (actionId === "ack") actions.update(taskId, { alarmAck: ack });
  else {
    actions.update(taskId, { alarmAck: ack });
    actions.reschedule({ kind: "task", taskId }, { kind: "hour" }, new Date(now));
  }
  return true;
}

export interface TapTarget {
  kind: NotifKind;
  taskId?: string;
  /** The notification's own key and its Done / Snooze reference: together they say exactly which card to open. */
  key?: string;
  ref?: string;
  /** A repeating task: which series and which day. */
  occ?: { id: string; date: string };
  /** Opened from the widget's Start button: start that item's timer, not just show it. */
  start?: boolean;
}

let activatedAt = Date.now();
/** Called from the app-state listener so we know when the app was last brought to the front. */
export const markActivated = () => {
  activatedAt = Date.now();
};

/**
 * Handles taps and button presses. Buttons update the task straight away, then send the app back to the
 * background (Capacitor's buttons open the app for a moment, so we tuck it away again).
 */
export async function listenForActions(onTap: (t: TapTarget) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const handle = await safely("addListener(actions)", () => LocalNotifications.addListener("localNotificationActionPerformed", async (e: ActionPerformed) => {
    const extra = (e.notification.extra ?? {}) as { setAlarm?: AlarmAction; taskId?: string; kind?: TapTarget["kind"]; key?: string; ref?: string; at?: number; occ?: { id: string; date: string } };
    const { actionId } = e;

    // "Set alarm" on the night-before reminder of an early start: a real Android alarm, then straight back to where you were.
    if (actionId === "setalarm" && extra.setAlarm) {
      await whenLoaded();
      await setEarlyAlarm(extra.setAlarm);
      if (Date.now() - activatedAt < 5000) {
        const { App } = await import("@capacitor/app");
        void safely("minimizeApp", () => App.minimizeApp(), undefined, 2000);
      }
      return;
    }

    // "Time's up" on a timer: Done logs it, +5 min keeps going.
    if (extra.kind === "timer" && ["done", "extend"].includes(actionId)) {
      await whenLoaded();
      applyTimerAction(actionId);
      if (Date.now() - activatedAt < 5000) {
        const { App } = await import("@capacitor/app");
        void safely("minimizeApp", () => App.minimizeApp(), undefined, 2000);
      }
      return;
    }

    // Session / chore / end-of-day buttons.
    if (extra.ref && ["done", "snooze", "skip"].includes(actionId)) {
      await whenLoaded();
      applyCheckInAction(actionId, extra.ref);
      if (Date.now() - activatedAt < 5000) {
        const { App } = await import("@capacitor/app");
        void safely("minimizeApp", () => App.minimizeApp(), undefined, 2000);
      }
      return;
    }

    if (actionId === "tap" || actionId === "dismiss" || !extra.taskId) {
      if (actionId === "tap" && extra.kind) {
        // Opening an alarm counts as seeing it: no more "Still waiting" follow-ups.
        if (extra.taskId && extra.at) {
          await whenLoaded();
          applyAlarmAction("ack", extra.taskId, extra.at);
        }
        onTap({ kind: extra.kind, taskId: extra.taskId, key: extra.key, ref: extra.ref, occ: extra.occ });
      }
      return;
    }
    await whenLoaded(); // cold start: wait for the saved data before touching it
    if (!applyAlarmAction(actionId, extra.taskId, extra.at)) {
      const task = extra.taskId ? findTask(getData(), extra.taskId) : undefined;
      if (!task || task.status !== "open") return;
      if (actionId === "ontrack") actions.recordCheckIn(task.id, "on-track");
      else if (actionId === "snooze") actions.reschedule({ kind: "task", taskId: task.id }, { kind: "hour" });
    }

    // If this button press is what brought the app forward, put it back where it was.
    if (Date.now() - activatedAt < 5000) {
      const { App } = await import("@capacitor/app");
      void safely("minimizeApp", () => App.minimizeApp(), undefined, 2000);
    }
  }), null);
  return () => handle?.remove();
}
