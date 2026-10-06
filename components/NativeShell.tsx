"use client";
import { useEffect, useRef } from "react";
import { initNotifications, listenForActions, markActivated, rescheduleAll, type TapTarget } from "@/lib/notifications/native";
import { isNative } from "@/lib/platform";
import { reloadFromStorage } from "@/lib/store";
import type { AppData } from "@/lib/types";

/**
 * Android-only plumbing (does nothing on the web):
 *  - hardware Back closes the top sheet first, and only minimises the app when none is open
 *  - re-reads storage when the app returns to the foreground
 *  - keeps Android's scheduled notifications in step with your data
 *  - handles taps and Done / On track / Snooze buttons on notifications
 */
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
          reloadFromStorage();
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

  // Reschedule after every change (a short pause lets typing/bursts settle). It skips the work if nothing differs.
  useEffect(() => {
    if (!isNative()) return;
    const id = setTimeout(() => {
      rescheduleAll(data);
    }, 1200);
    return () => clearTimeout(id);
  }, [data]);

  return null;
}
