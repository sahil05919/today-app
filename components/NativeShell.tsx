"use client";
import { useEffect, useRef, useState } from "react";
import { getStatus, initNotifications, listenForActions, markActivated, openExactAlarmSettings, type TapTarget } from "@/lib/notifications/native";
import { installCalendarWriter } from "@/lib/calendarWrite";
import { todayISO } from "@/lib/dates";
import { isNative } from "@/lib/platform";
import { safely } from "@/lib/nativeGuard";
import { closeTopSheet } from "@/lib/sheetStack";
import { actions, flushNow, getData, whenLoaded } from "@/lib/store";
import { requestSync } from "@/lib/syncPipeline";
import { startSync } from "@/lib/syncSteps";
import type { AppData } from "@/lib/types";
import { btn, Sheet } from "./ui";

/**
 * Android-only plumbing (does nothing on the web):
 *  - hardware Back closes the top sheet first, and only minimises the app when none is open
 *  - saves any unsaved change the moment the app goes to the background, and syncs again when it comes back
 *  - handles taps and Done / On track / +1 hour buttons on notifications
 *
 * Everything that reaches outside the app (reminders, the Plan calendar, the widget, the backup check) is NOT done here: it is
 * the sync pipeline (lib/syncPipeline.ts), which this component only starts and pokes.
 */
export function NativeShell({ data, onTap }: { data: AppData; onTap: (t: TapTarget) => void }) {
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const [needExact, setNeedExact] = useState(false);

  // Android 12+ keeps exact alarms off until you allow them: say so ONCE, with a button to the right settings screen.
  useEffect(() => {
    if (!isNative()) return;
    let gone = false;
    (async () => {
      await whenLoaded();
      await initNotifications();
      const st = await getStatus();
      if (!gone && st.supported && st.permission === "granted" && st.exact != null && st.exact !== "granted" && !getData().settings.exactAsked) setNeedExact(true);
    })();
    return () => {
      gone = true;
    };
  }, []);

  // App-level listeners, set up once.
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    const cleanup: Array<() => void> = [];

    import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      void safely("addListener(backButton)", () =>
        App.addListener("backButton", () => {
          // Back closes ONLY the top sheet; with none open the app goes to the background.
          if (!closeTopSheet()) void safely("minimizeApp", () => App.minimizeApp(), undefined, 2000);
        }),
      null).then((h) => h && cleanup.push(() => h.remove()));
      void safely("addListener(appStateChange)", () =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            markActivated();
            requestSync("resume", { immediate: true });
          } else {
            // Going to the background: nothing may stay unsaved.
            void flushNow();
          }
        }),
      null).then((h) => h && cleanup.push(() => h.remove()));
      void safely("addListener(pause)", () => App.addListener("pause", () => void flushNow()), null).then((h) => h && cleanup.push(() => h.remove()));
    });

    initNotifications().then(() => listenForActions((t) => tapRef.current(t)).then((off) => (cancelled ? off() : cleanup.push(off))));

    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);

  // From now on the events you create follow into the phone calendar, and the sync pipeline runs (reminders, Plan calendar,
  // widget, backup check). The pipeline listens to the store itself: a change anywhere ends up as ONE run ~0.8 s later.
  useEffect(() => {
    if (!isNative()) return;
    installCalendarWriter();
    startSync();
  }, []);

  // Turning the calendar read on or off, or any Plan / Inbox setting, is worth a run of its own.
  const calendarKey = `${data.profile?.calendarSync}|${data.profile?.planMirror}|${data.profile?.planCalendarId}|${data.profile?.inboxCalendarId}`;
  const firstKey = useRef(calendarKey);
  useEffect(() => {
    if (!isNative() || firstKey.current === calendarKey) return;
    firstKey.current = calendarKey;
    requestSync("manual");
  }, [calendarKey]);

  // The widget (and a day that rolls over while the app stays open) is refreshed every few minutes.
  useEffect(() => {
    if (!isNative()) return;
    let day = todayISO();
    const id = setInterval(() => {
      // A new day while the app stays open: the daily jobs (Plan calendar, Inbox, backup check) run too.
      const now = todayISO();
      requestSync(now === day ? "tick" : "daily");
      day = now;
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const answered = () => {
    actions.settings({ exactAsked: true });
    setNeedExact(false);
  };
  if (!needExact) return null;
  return (
    <Sheet title="Allow exact reminders" onClose={answered}>
      <p className="-mt-1 mb-4 text-[15px] leading-relaxed">
        Without this, Android can hold back a reminder by several minutes, so your daily 11:00 vitamin might arrive at 11:07. One switch fixes it: <b>Allow setting alarms and reminders</b> for Today.
      </p>
      <div className="space-y-2">
        <button
          className={`${btn.primary} min-h-12 w-full`}
          onClick={async () => {
            answered();
            await openExactAlarmSettings();
            requestSync("manual", { force: true });
          }}
        >
          Open the setting
        </button>
        <button className={`${btn.ghost} min-h-12 w-full`} onClick={answered}>
          Not now
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">You can change this later in Menu → Settings → Notifications.</p>
    </Sheet>
  );
}
