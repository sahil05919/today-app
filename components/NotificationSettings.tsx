"use client";
import { useCallback, useEffect, useState } from "react";
import { batteryUnrestricted, openBatterySettings } from "@/lib/nativeBridge";
import {
  getStatus,
  openExactAlarmSettings,
  rescheduleAll,
  requestPermission,
  sendTest,
  type NotifStatus,
} from "@/lib/notifications/native";
import { getData } from "@/lib/store";
import type { Profile } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

const TOGGLES: [keyof Profile["notify"], string, string][] = [
  ["morning", "Morning check-in", "“3 things today” plus what's due soon"],
  ["taskCheckIns", "Task check-ins", "“Due Friday, where are you?” with Done / On track / Snooze"],
  ["wrap", "Evening wrap-up", "A nudge to roll unfinished things forward"],
  ["reminders", "Reminders", "At a task's scheduled time"],
  ["slots", "Plan-my-day slots", "When a planned block starts"],
];

/** Android-only: notification permissions, exact alarms and battery optimisation, with plain-English help. */
export function NotificationSettings({
  notify,
  onChange,
  ctx,
}: {
  notify: Profile["notify"];
  onChange: (n: Profile["notify"]) => void;
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

  if (status && !status.supported) {
    return (
      <p className="rounded-xl bg-bg p-3 text-sm text-muted">
        Notifications run inside the Android app, on the phone itself with no internet needed. You can still choose which ones you want below.
      </p>
    );
  }

  const Status = ({ ok, label }: { ok: boolean | null; label: string }) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"}`}>
      {ok == null ? "…" : ok ? "✓ " : "! "}
      {label}
    </span>
  );

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {TOGGLES.map(([key, title, hint]) => (
          <li key={key}>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2">
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
          </li>
        ))}
      </ul>

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
                if (r === "granted") rescheduleAll(getData(), { force: true });
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
    </div>
  );
}
