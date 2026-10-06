import { LocalNotifications, type ActionPerformed } from "@capacitor/local-notifications";
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
const TASK_ACTIONS = "TASK";

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
        {
          id: TASK_ACTIONS,
          actions: [
            { id: "done", title: "✓ Done" },
            { id: "ontrack", title: "On track" },
            { id: "snooze", title: "Snooze 2h" },
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
  channelId: n.exact ? CH_REMINDERS : CH_GENTLE,
  actionTypeId: n.actions ? TASK_ACTIONS : undefined,
  smallIcon: "ic_stat_today",
  autoCancel: true,
  extra: { taskId: n.taskId, kind: n.kind, key: n.key },
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
        body: "Sahil's Today can reach you here.",
        schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        channelId: CH_REMINDERS,
        smallIcon: "ic_stat_today",
      },
    ],
  });
  return true;
}

export interface TapTarget {
  kind: "morning" | "checkin" | "wrap" | "reminder" | "slot";
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
    const extra = (e.notification.extra ?? {}) as { taskId?: string; kind?: TapTarget["kind"] };
    const { actionId } = e;
    if (actionId === "tap" || actionId === "dismiss" || !extra.taskId) {
      if (actionId === "tap" && extra.kind) onTap({ kind: extra.kind, taskId: extra.taskId });
      return;
    }
    await whenLoaded(); // cold start: wait for the saved data before touching it
    const task = getData().tasks.find((t) => t.id === extra.taskId);
    if (!task || task.status !== "open") return;

    if (actionId === "done") actions.toggleDone(task.id);
    else if (actionId === "ontrack") actions.recordCheckIn(task.id, "on-track");
    else if (actionId === "snooze") actions.update(task.id, { remindAt: Date.now() + 2 * 3600_000 });

    // If this button press is what brought the app forward, put it back where it was.
    if (Date.now() - activatedAt < 5000) {
      const { App } = await import("@capacitor/app");
      App.minimizeApp().catch(() => {});
    }
  });
  return () => handle.remove();
}
