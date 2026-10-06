"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { dueAlarms, SNOOZE_CHOICES, type DueAlarm } from "@/lib/alarms";
import { isNative } from "@/lib/platform";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn } from "./ui";

/** A short two-tone beep, repeated by the caller. Needs an AudioContext that a tap has already unlocked. */
function beep(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  [880, 1175].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.22 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + i * 0.22);
    osc.stop(t0 + i * 0.22 + 0.22);
  });
}

/** A system notification for when the tab is in the background (web only; the Android app has its own). */
async function showSystemNotification(a: DueAlarm) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const opts: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: "It's time.",
    tag: a.key,
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 200, 400, 200, 800],
    icon: "/icon-192.png",
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(a.title, opts);
  } catch {
    /* fall through to the plain constructor */
  }
  try {
    new Notification(a.title, opts);
  } catch {
    /* some mobile browsers only allow the service-worker route */
  }
}

/**
 * Rings a timed reminder like an alarm clock while the app is open: a full-screen card with Done and Snooze,
 * a repeating beep and vibration, and a system notification if the tab is hidden. When the app is closed on the
 * web nothing can ring (a browser can't wake itself up); the Android app schedules real alarms for that.
 */
export function AlarmRinger({ data }: { data: AppData }) {
  const [ringing, setRinging] = useState<DueAlarm[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;
  const audio = useRef<AudioContext | null>(null);
  const notified = useRef(new Set<string>());
  const testAlarm = useRef<DueAlarm | null>(null);

  // Browsers only let a page make sound after a tap, so unlock audio on the first one.
  useEffect(() => {
    const unlock = () => {
      try {
        if (!audio.current) audio.current = new AudioContext();
        if (audio.current.state === "suspended") void audio.current.resume();
      } catch {
        /* no audio: the card and vibration still work */
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Check every second (cheap), and straight away when the tab comes back to the front.
  useEffect(() => {
    const check = () => {
      const due = dueAlarms(dataRef.current);
      const test = testAlarm.current;
      const all = test ? [test, ...due] : due;
      setRinging((prev) => (prev.map((a) => a.key).join() === all.map((a) => a.key).join() ? prev : all));
      for (const a of all) {
        if (notified.current.has(a.key)) continue;
        notified.current.add(a.key);
        if (document.visibilityState === "hidden" && !isNative()) void showSystemNotification(a);
      }
    };
    check();
    const id = setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    // "Ring a test alarm" in Me → Notifications.
    const onTest = () => {
      setTimeout(() => {
        testAlarm.current = { key: `test@${Date.now()}`, taskId: "", title: "Test alarm", at: Date.now() };
        check();
      }, 8000);
    };
    window.addEventListener("today:test-alarm", onTest);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("today:test-alarm", onTest);
    };
  }, []);

  const current = ringing[0];

  // Sound and vibration while a card is showing. (The Android app's own notification already makes the sound.)
  useEffect(() => {
    if (!current) return;
    const buzz = () => {
      if (!isNative() && audio.current?.state === "running") beep(audio.current);
      navigator.vibrate?.([300, 150, 300]);
    };
    buzz();
    const id = setInterval(buzz, 1800);
    return () => clearInterval(id);
  }, [current]);

  const answer = useCallback((a: DueAlarm, what: "done" | "stop" | number) => {
    if (!a.taskId) {
      testAlarm.current = null;
    } else if (what === "done") {
      actions.toggleDone(a.taskId);
    } else if (what === "stop") {
      actions.update(a.taskId, { alarmAck: Date.now() });
    } else {
      actions.update(a.taskId, { alarmAck: Date.now(), remindAt: Date.now() + what * 60_000 });
    }
    setRinging((r) => r.filter((x) => x.key !== a.key));
  }, []);

  if (!current) return null;
  const time = new Date(current.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const label = (m: number) => (m >= 60 ? `${m / 60} h` : `${m} min`);

  return (
    <div role="alertdialog" aria-modal="true" aria-label={`Reminder: ${current.title}`} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5">
      <div className="anim-fade w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-2xl">
        <p className="text-5xl" aria-hidden>
          ⏰
        </p>
        <p className="mt-3 text-sm font-medium text-muted">{time}</p>
        <h2 className="mt-1 break-words text-2xl font-semibold tracking-tight">{current.title}</h2>
        {ringing.length > 1 && <p className="mt-1 text-xs text-muted">+{ringing.length - 1} more waiting</p>}
        <div className="mt-6 space-y-2">
          <button className={`${btn.primary} min-h-12 w-full text-base`} onClick={() => answer(current, current.taskId ? "done" : "stop")}>
            {current.taskId ? "✓ Done" : "Stop"}
          </button>
          {current.taskId && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {SNOOZE_CHOICES.map((m) => (
                  <button key={m} className={`${btn.soft} min-h-12`} onClick={() => answer(current, m)}>
                    Snooze {label(m)}
                  </button>
                ))}
              </div>
              <button className={`${btn.link} min-h-11`} onClick={() => answer(current, "stop")}>
                Stop ringing (keep the task)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
