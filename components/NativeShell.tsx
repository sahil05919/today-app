"use client";
import { useEffect, useRef } from "react";
import { initNotifications, listenForActions, markActivated, rescheduleAll, type TapTarget } from "@/lib/notifications/native";
import { syncPhoneCalendar } from "@/lib/calendarSync";
import { isNative } from "@/lib/platform";
import { pushWidgetSnapshot, takeWidgetActions } from "@/lib/nativeBridge";
import { getData, reloadFromStorage, whenLoaded } from "@/lib/store";
import { buildWidgetSnapshot, snapshotSignature } from "@/lib/widget";
import { applyWidgetActions } from "@/lib/widgetRun";
import type { AppData } from "@/lib/types";

/**
 * Android-only plumbing (does nothing on the web):
 *  - hardware Back closes the top sheet first, and only minimises the app when none is open
 *  - re-reads storage when the app returns to the foreground
 *  - keeps Android's scheduled notifications in step with your data
 *  - handles taps and Done / On track / Snooze buttons on notifications
 *  - keeps the home-screen widget's snapshot fresh, and applies the Dones tapped on it
 */

/** Dones tapped on the widget are applied through the normal actions, once the saved data is loaded. */
async function absorbWidgetActions() {
  await whenLoaded();
  const list = await takeWidgetActions();
  if (list.length) applyWidgetActions(list);
}

let lastWidgetSig = "";
/** Computes the widget's snapshot from the data and hands it to Android when it differs from what it has. */
function syncWidget(force = false) {
  const snap = buildWidgetSnapshot(getData(), new Date());
  const sig = snapshotSignature(snap);
  if (!force && sig === lastWidgetSig) return;
  lastWidgetSig = sig;
  pushWidgetSnapshot(sig).then((ok) => {
    if (!ok) lastWidgetSig = "";
  });
}
export function NativeShell({ data, onTap }: { data: AppData; onTap: (t: TapTarget) => void }) {
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  // App-level listeners, set up once.
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    const cleanup: Array<() => void> = [];

    import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      App.addListener("backButton", () => {
        if (document.querySelector('[role="dialog"]')) {
          // Sheets already close on Escape.
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        } else {
          App.minimizeApp();
        }
      }).then((h) => cleanup.push(() => h.remove()));
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          markActivated();
          absorbWidgetActions()
            .then(() => reloadFromStorage())
            .then(() => {
              syncPhoneCalendar();
              syncWidget(true);
            });
        }
      }).then((h) => cleanup.push(() => h.remove()));
    });

    initNotifications().then(() =>
      listenForActions((t) => tapRef.current(t)).then((off) => (cancelled ? off() : cleanup.push(off))),
    );

    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);

  // Cold start: apply anything tapped on the widget while the app was closed.
  useEffect(() => {
    if (isNative()) void absorbWidgetActions().then(() => syncWidget(true));
  }, []);

  // Read the phone's calendar when the app opens (asking permission once), and again each time you come back to it.
  useEffect(() => {
    if (!isNative()) return;
    syncPhoneCalendar({ ask: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.profile?.calendarSync]);

  // Reschedule after every change (a short pause lets typing/bursts settle). It skips the work if nothing differs.
  useEffect(() => {
    if (!isNative()) return;
    const id = setTimeout(() => {
      rescheduleAll(data);
    }, 1200);
    return () => clearTimeout(id);
  }, [data]);

  // The widget: after every change, and every few minutes so a new day or a passed time is never stale.
  useEffect(() => {
    if (!isNative()) return;
    const id = setTimeout(() => syncWidget(), 1500);
    return () => clearTimeout(id);
  }, [data]);
  useEffect(() => {
    if (!isNative()) return;
    const id = setInterval(() => syncWidget(), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  return null;
}
