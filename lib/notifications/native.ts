import { LocalNotifications, type ActionPerformed } from "@capacitor/local-notifications";
import { createAlarmChannel } from "../nativeBridge";
import { isNative } from "../platform";
import { actions, getData, whenLoaded } from "../store";
import { planNotifications, signature, type PlannedNotification } from "./plan";
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
export const SNOOZE_MINUTES = 30;

/**
 * Done / Snooze / Skip on a session, chore or end-of-day check-in.
 * `ref` is "session:<areaId>:<date>", "chore:<id>:<date>" or "wrap:<date>".
 * Done counts the session ("Power BI session 14"); Snooze asks again later; Skip leaves it uncounted today.
 */
export function applyCheckInAction(actionId: string, ref: string, now = Date.now()) {
  const [kind, ...rest] = ref.split(":");
  const date = rest[rest.length - 1];
  if (actionId === "done") {
    if (kind === "session") {
      // Already counted? Then Done is a no-op, never an undo.
      const done = getData().sessions?.some((l) => l.areaId === rest[0] && l.date === date);
      if (!done) actions.toggleSession(rest[0], date, "checkin");
    } else if (kind === "wrap") actions.markDayDone(date);
    else if (kind === "bill") actions.completeBill(rest[0], date);
    else actions.setEntry(ref, "done");
  } else if (actionId === "skip") actions.setEntry(ref, "skip");
  else if (actionId === "snooze") actions.setEntry(ref, "snooze", now + SNOOZE_MINUTES * 60_000);
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
    LocalNotifications.checkPermissions().catch(() => ({ display: "prompt" })),
    LocalNotifications.checkExactNotificationSetting().catch(() => null),
  ]);
  return { supported: true, permission: norm(p.display), exact: e ? norm(e.exact_alarm) : null };
}

/** Android 13+ asks "Allow Today to send you notifications?" */
export async function requestPermission(): Promise<PermissionState> {
  if (!isNative()) return "denied";
  const r = await LocalNotifications.requestPermissions().catch(() => ({ display: "denied" }));
  return norm(r.display);
}

/** Opens Android's "Alarms & reminders" screen so exact reminders can be allowed. */
export async function openExactAlarmSettings(): Promise<PermissionState | null> {
  if (!isNative()) return null;
  const r = await LocalNotifications.changeExactNotificationSetting().catch(() => null);
  return r ? norm(r.exact_alarm) : null;
}

let inited = false;
/** Creates the channels and the Done / On track / Snooze buttons. Safe to call repeatedly. */
export async function initNotifications() {
  if (!isNative() || inited) return;
  inited = true;
  try {
    // Alarm channel first: native code gives it the alarm sound. If that fails, a plain loud channel is the fallback.
    if (!(await createAlarmChannel(CH_ALARM))) {
      await LocalNotifications.createChannel({
        id: CH_ALARM,
        name: "Alarms",
        description: "Reminders you set for a specific time",
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    }
    await LocalNotifications.createChannel({
      id: CH_REMINDERS,
      name: "Reminders",
      description: "Reminders at a task's time, and the start of your planned slots",
      importance: 4,
      visibility: 1,
      vibration: true,
    });
    await LocalNotifications.createChannel({
      id: CH_GENTLE,
      name: "Check-ins",
      description: "Morning plan, task check-ins and the evening wrap-up",
      importance: 3,
      visibility: 1,
      vibration: false,
    });
    // Android shows at most 3 buttons. "Behind" is what happens when you tap the notification itself.
    await LocalNotifications.registerActionTypes({
      types: [
        // A timed reminder behaves like a phone alarm: Done, or snooze for a short or a long while.
        {
          id: ALARM_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "snooze10", title: "Snooze 10 min" },
            { id: "snooze60", title: "Snooze 1 h" },
          ],
        },
        {
          id: TASK_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "ontrack", title: "On track" },
            { id: "snooze", title: "Snooze 2h" },
          ],
        },
        // Sessions, chores ("Have you sorted your email?") and the end-of-day question.
        {
          id: CHECKIN_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "snooze", title: "Snooze" },
            { id: "skip", title: "Skip" },
          ],
        },
      ],
    });
  } catch (e) {
    console.warn("Notification setup failed", e);
    inited = false;
  }
}

const toSchema = (n: PlannedNotification, exactAllowed: boolean) => ({
  id: n.id,
  title: n.title,
  body: n.body,
  largeBody: n.largeBody,
  schedule: { at: n.at, allowWhileIdle: true },
  channelId: n.alarm ? CH_ALARM : n.exact ? CH_REMINDERS : CH_GENTLE,
  actionTypeId: n.actions ? (n.alarm ? ALARM_ACTIONS : n.ref ? CHECKIN_ACTIONS : TASK_ACTIONS) : undefined,
  smallIcon: "ic_stat_today",
  autoCancel: true,
  extra: { taskId: n.taskId, kind: n.kind, key: n.key, ref: n.ref, at: n.at.getTime() },
  // Only ask for a precise alarm when it's already allowed, so rescheduling never throws up a settings screen.
  isExactNotification: n.exact && exactAllowed,
  isExactMandatory: false,
});

let lastSig = "";
let chain: Promise<unknown> = Promise.resolve();

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
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length) {
        await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      }
      if (plan.length) {
        const exact = status.exact === "granted";
        await LocalNotifications.schedule({ notifications: plan.map((n) => toSchema(n, exact)) });
      }
      lastSig = sig;
    } catch (e) {
      console.warn("Could not schedule notifications", e);
      lastSig = ""; // try again next time
    }
    return plan.length;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

/** A notification 5 seconds from now, to check everything is wired up. */
export async function sendTest(): Promise<boolean> {
  if (!isNative()) return false;
  await initNotifications();
  if ((await getStatus()).permission !== "granted") return false;
  await LocalNotifications.schedule({
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
  });
  return true;
}

/**
 * Buttons on a timed reminder. "done" finishes the task; "snooze10" / "snooze60" ring again later;
 * "ack" just means you saw it. Returns false when the action isn't an alarm one.
 */
export function applyAlarmAction(actionId: string, taskId: string, firedAt = Date.now(), now = Date.now()): boolean {
  if (!["done", "snooze10", "snooze60", "ack"].includes(actionId)) return false;
  const task = getData().tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "open") return true; // already finished or deleted: nothing to do
  const ack = Math.max(firedAt, now);
  if (actionId === "done") actions.toggleDone(taskId);
  else if (actionId === "ack") actions.update(taskId, { alarmAck: ack });
  else actions.update(taskId, { alarmAck: ack, remindAt: now + (actionId === "snooze10" ? 10 : 60) * 60_000 });
  return true;
}

export interface TapTarget {
  kind: "morning" | "checkin" | "wrap" | "reminder" | "slot" | "session" | "chore" | "nudge" | "event" | "bill" | "review";
  taskId?: string;
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
  const handle = await LocalNotifications.addListener("localNotificationActionPerformed", async (e: ActionPerformed) => {
    const extra = (e.notification.extra ?? {}) as { taskId?: string; kind?: TapTarget["kind"]; ref?: string; at?: number };
    const { actionId } = e;

    // Session / chore / end-of-day buttons.
    if (extra.ref && ["done", "snooze", "skip"].includes(actionId)) {
      await whenLoaded();
      applyCheckInAction(actionId, extra.ref);
      if (Date.now() - activatedAt < 5000) {
        const { App } = await import("@capacitor/app");
        App.minimizeApp().catch(() => {});
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
        onTap({ kind: extra.kind, taskId: extra.taskId });
      }
      return;
    }
    await whenLoaded(); // cold start: wait for the saved data before touching it
    if (!applyAlarmAction(actionId, extra.taskId, extra.at)) {
      const task = getData().tasks.find((t) => t.id === extra.taskId);
      if (!task || task.status !== "open") return;
      if (actionId === "ontrack") actions.recordCheckIn(task.id, "on-track");
      else if (actionId === "snooze") actions.update(task.id, { remindAt: Date.now() + 2 * 3600_000 });
    }

    // If this button press is what brought the app forward, put it back where it was.
    if (Date.now() - activatedAt < 5000) {
      const { App } = await import("@capacitor/app");
      App.minimizeApp().catch(() => {});
    }
  });
  return () => handle.remove();
}
