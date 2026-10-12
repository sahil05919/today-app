"use client";
import { useCallback, useEffect, useState } from "react";
import { batteryUnrestricted, openBatterySettings } from "@/lib/nativeBridge";
import {
  getStatus,
  openExactAlarmSettings,
  requestPermission,
  sendTest,
  type NotifStatus,
} from "@/lib/notifications/native";
import { requestSync } from "@/lib/syncPipeline";
import type { Profile } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

type TimeKey = "briefTime" | "checkinTime" | "eveningWrap" | "reviewTime" | "fridayReviewTime" | "nudgeTime" | "taskCheckIn";

/** [switch, title, what it is, the time you can edit]. At most five a day that do not have a fixed time of their own. */
const TOGGLES: [keyof Profile["notify"], string, string, TimeKey?][] = [
  ["morning", "Morning brief", "Only if you haven't opened the app yet: today's must-dos and one focus", "briefTime"],
  ["quote", "A quote for you", "Its own notification, once a day, at a random time"],
  ["tonight", "Evening check-in", "What's left tonight, and anything from email to add", "checkinTime"],
  ["sessionNudges", "Session nudges", "At the planned time, only for areas behind their weekly target"],
  ["wrap", "End of day", "“Tick or move what's left”, only if something is open", "eveningWrap"],
  ["dayDone", "All done for today", "A cheer when your list is finished, and a way to lighten the week"],
  ["taskCheckIns", "Task check-ins", "“Due Friday, where are you?” with Done / On track / +1 hour", "taskCheckIn"],
  ["reminders", "Reminders", "At a task's scheduled time (never counted in the daily five)"],
  ["slots", "Plan-my-day slots", "When a planned block starts"],
  ["events", "Fixed events", "A heads-up before they start (never counted)"],
  ["bills", "Bills & chores", "Rent, card, clean room, grocery run (never counted)"],
  ["nudges", "Gentle nudges", "Empty day, neglected area, behind target", "nudgeTime"],
  ["weekSoFar", "Friday “Week so far”", "Where you stand, and light weekend catch-ups only if you tap", "fridayReviewTime"],
  ["review", "Sunday “Your week”", "Wins, what slipped, your own tasks and a focus for next week", "reviewTime"],
];

/** Android-only: notification permissions, exact alarms and battery optimisation, with plain-English help. */
export function NotificationSettings({
  notify,
  onChange,
  profile,
  onProfile,
  ctx,
}: {
  notify: Profile["notify"];
  onChange: (n: Profile["notify"]) => void;
  profile: Profile;
  onProfile: (patch: Partial<Profile>) => void;
  ctx: ViewCtx;
}) {
  const [status, setStatus] = useState<NotifStatus | null>(null);
  const [battery, setBattery] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await getStatus());
    setBattery(await batteryUnrestricted());
  }, []);

  // Re-check when you come back from a system settings screen.
  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const Status = ({ ok, label }: { ok: boolean | null; label: string }) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"}`}>
      {ok == null ? "…" : ok ? "✓ " : "! "}
      {label}
    </span>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">At most 5 a day, not counting reminders that have a time of their own (the vitamin, bills, events). When a day has more, the least useful are dropped first.</p>
      <ul className="space-y-1.5">
        {TOGGLES.map(([key, title, hint, timeKey]) => (
          <li key={key} className="rounded-xl border border-line bg-bg px-3 py-2">
            <label className="flex min-h-10 items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
              <input
                type="checkbox"
                checked={notify[key]}
                onChange={(e) => onChange({ ...notify, [key]: e.target.checked })}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
            {notify[key] && timeKey && (
              <label className="mt-1 flex items-center gap-2 text-xs text-muted">
                At
                <input type="time" value={profile[timeKey]} onChange={(e) => e.target.value && onProfile({ [timeKey]: e.target.value })} aria-label={`${title} time`} className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
              </label>
            )}
            {key === "quote" && notify.quote && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                Between
                <input type="time" value={profile.quoteFrom} onChange={(e) => e.target.value && onProfile({ quoteFrom: e.target.value })} aria-label="Quote earliest" className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
                and
                <input type="time" value={profile.quoteTo} onChange={(e) => e.target.value && onProfile({ quoteTo: e.target.value })} aria-label="Quote latest" className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
                <select value={profile.quoteEvery || 1} onChange={(e) => onProfile({ quoteEvery: Number(e.target.value) as Profile["quoteEvery"] })} aria-label="How often" className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink">
                  <option value={1}>every day</option>
                  <option value={2}>every 2 days</option>
                  <option value={3}>every 3 days</option>
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>

      {status && !status.supported && <WebAlarms />}

      {status?.supported && (
      <div className="space-y-3 rounded-2xl border border-line p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Allow notifications</p>
            <p className="text-xs text-muted">Android 13+ asks you once.</p>
          </div>
          {status?.permission === "granted" ? (
            <Status ok label="On" />
          ) : (
            <button
              className={`${btn.primary} min-h-11`}
              onClick={async () => {
                const r = await requestPermission();
                await refresh();
                if (r === "granted") requestSync("manual", { force: true });
                else ctx.notify("Notifications are off. You can turn them on in Android's app settings.");
              }}
            >
              Allow
            </button>
          )}
        </div>

        {status?.exact != null && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Exact reminders</p>
              <p className="text-xs text-muted">Otherwise a reminder can arrive a few minutes late.</p>
            </div>
            {status.exact === "granted" ? (
              <Status ok label="On" />
            ) : (
              <button
                className={`${btn.soft} min-h-11`}
                onClick={async () => {
                  await openExactAlarmSettings();
                  await refresh();
                }}
              >
                Allow
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Battery</p>
            <p className="text-xs text-muted">
              {battery === false
                ? "Android may put the app to sleep and skip reminders."
                : "Android won't put the app to sleep."}
            </p>
          </div>
          {battery === false ? (
            <button className={`${btn.soft} min-h-11`} onClick={() => openBatterySettings()}>
              Fix
            </button>
          ) : (
            <Status ok={battery} label={battery == null ? "" : "Unrestricted"} />
          )}
        </div>
        {battery === false && (
          <p className="rounded-xl bg-warn-soft p-3 text-xs leading-relaxed text-ink">
            In the list that opens: choose <b>All apps</b>, find <b>Today by Sahil</b>, then pick <b>Don't optimise</b> (or <b>Unrestricted</b>). On
            Xiaomi, Oppo, Vivo, OnePlus and Samsung, also allow <b>Autostart</b> / <b>Background activity</b> for the app in its settings.
          </p>
        )}

        <button
          className={`${btn.ghost} min-h-11 w-full`}
          onClick={async () => {
            const ok = await sendTest();
            ctx.notify(ok ? "Test notification in 5 seconds. Lock your screen to see it." : "Allow notifications first.");
          }}
        >
          Send a test notification
        </button>
      </div>
      )}
    </div>
  );
}

/** The browser / installed-PWA version: alerts work while Today is open (or minimised on a computer). */
function WebAlarms() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  return (
    <div className="space-y-3 rounded-2xl border border-line p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Browser notifications</p>
          <p className="text-xs text-muted">So a reminder can pop up when Today is in another tab or window.</p>
        </div>
        {perm === "granted" ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">✓ On</span>
        ) : perm === "unsupported" ? (
          <span className="text-xs text-muted">Not supported</span>
        ) : (
          <button
            className={`${btn.primary} min-h-11`}
            onClick={async () => setPerm(await Notification.requestPermission())}
            disabled={perm === "denied"}
          >
            {perm === "denied" ? "Blocked" : "Allow"}
          </button>
        )}
      </div>
      {perm === "denied" && <p className="text-xs text-muted">Blocked in the browser. Click the lock icon next to the address bar and allow notifications for this site.</p>}
      <button className={`${btn.ghost} min-h-11 w-full`} onClick={() => window.dispatchEvent(new Event("today:test-alarm"))}>
        Ring a test alarm in 8 seconds
      </button>
      <p className="rounded-xl bg-warn-soft p-3 text-xs leading-relaxed text-ink">
        <b>In the browser, Today can only ring while it is open</b> (a tab can stay in the background, but not if you close it or the phone puts the browser to sleep).
        For an alarm that goes off with the app closed and the screen locked, like the Clock app, use the <b>Android app</b>: it sets real phone alarms.
      </p>
    </div>
  );
}
