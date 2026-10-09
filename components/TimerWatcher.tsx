"use client";
import { useEffect, useRef, useState } from "react";
import { cheerLine } from "@/lib/cheer";
import { buzz } from "@/lib/haptics";
import { rescheduleAll } from "@/lib/notifications/native";
import { actions, getData } from "@/lib/store";
import { timerPhase } from "@/lib/timer";
import { completeTimer, extendTimer } from "@/lib/timerRun";
import type { AppData } from "@/lib/types";
import { installChimeUnlock, playChime } from "./chime";
import { btn, type ViewCtx } from "./ui";

type Ask = { kind: "task-done"; taskId: string; title: string; minutes: number } | { kind: "still-going"; title: string } | null;

/** Vibrate in a pattern the phone can't miss, plus a chime if audio is allowed. (The locked-screen case is the scheduled alarm.) */
function ring() {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 500]);
  } catch {
    /* ignore */
  }
  buzz(40);
  playChime();
}

/**
 * Always mounted. Watches the running timer:
 *  - a timer with a goal stops itself at zero (a session / chore / bill is counted; a task asks "Done?")
 *  - one without a goal asks "Still going?" after an hour and stops after three
 * If the app was closed when the time ran out, this runs the moment it opens again.
 */
export function TimerWatcher({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const [ask, setAsk] = useState<Ask>(null);
  const asked = useRef<number | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => installChimeUnlock(), []);

  const timerKey = data.settings.timer ? `${data.settings.timer.startedAt}:${data.settings.timer.goalMin ?? 0}` : "";
  useEffect(() => {
    if (!timerKey) return;
    const check = () => {
      const timer = dataRef.current.settings.timer;
      if (!timer) return;
      const ph = timerPhase(timer, Date.now());
      const name = ctxRef.current.profile.name;
      if (ph.phase === "finished") {
        const task = timer.taskId ? dataRef.current.tasks.find((t) => t.id === timer.taskId) : undefined;
        const title = task?.title ?? timer.label ?? "Timer";
        ring();
        if (task) {
          const logged = actions.stopTimer();
          setAsk({ kind: "task-done", taskId: task.id, title, minutes: logged?.minutes ?? timer.goalMin ?? 0 });
        } else {
          completeTimer();
          ctxRef.current.notify(`${title} done, ${name} 🌿`);
        }
        void rescheduleAll(getData());
      } else if (ph.phase === "auto-stop") {
        actions.stopTimer();
        ctxRef.current.notify("Timer stopped after 3 hours. Logged what you did.");
        void rescheduleAll(getData());
      } else if (ph.phase === "still-going" && asked.current !== timer.startedAt) {
        asked.current = timer.startedAt;
        ring();
        setAsk({ kind: "still-going", title: (timer.taskId ? dataRef.current.tasks.find((t) => t.id === timer.taskId)?.title : timer.label) ?? "Timer" });
      }
    };
    check();
    const id = setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [timerKey]);

  if (!ask) return null;
  const name = ctx.profile.name;
  const close = () => setAsk(null);

  return (
    <div role="alertdialog" aria-modal="true" aria-label="Timer" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-5">
      <div className="anim-fade w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-2xl">
        <p className="text-5xl" aria-hidden="true">
          {ask.kind === "task-done" ? "⏱️" : "🤔"}
        </p>
        <h2 className="mt-3 break-words text-xl font-semibold tracking-tight">{ask.kind === "task-done" ? `Time's up, ${name}` : `Still going, ${name}?`}</h2>
        <p className="mt-1 break-words text-sm text-muted">
          {ask.kind === "task-done" ? `${ask.title}: ${ask.minutes} min logged. Is it done?` : `${ask.title} has been running for an hour.`}
        </p>
        <div className="mt-5 space-y-2">
          {ask.kind === "task-done" ? (
            <>
              <button
                className={`${btn.primary} min-h-12 w-full text-base`}
                onClick={() => {
                  const t = getData().tasks.find((x) => x.id === ask.taskId);
                  if (t && t.status === "open") {
                    actions.toggleDone(t.id);
                    ctx.notify(cheerLine(name, 1), () => actions.toggleDone(t.id));
                  }
                  close();
                }}
              >
                ✓ Done
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`${btn.soft} min-h-12`}
                  onClick={() => {
                    actions.startTimer(ask.taskId, 5);
                    close();
                  }}
                >
                  +5 min
                </button>
                <button className={`${btn.ghost} min-h-12`} onClick={close}>
                  Not yet
                </button>
              </div>
            </>
          ) : (
            <>
              <button className={`${btn.primary} min-h-12 w-full text-base`} onClick={close}>
                Keep going
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`${btn.soft} min-h-12`}
                  onClick={() => {
                    completeTimer();
                    ctx.notify(cheerLine(name, 1));
                    close();
                  }}
                >
                  ✓ Done
                </button>
                <button
                  className={`${btn.ghost} min-h-12`}
                  onClick={() => {
                    const logged = actions.stopTimer();
                    if (logged) ctx.notify(`Logged ${logged.minutes} min on “${logged.task.title}”`);
                    close();
                  }}
                >
                  Stop
                </button>
              </div>
              <button
                className={`${btn.link} min-h-11`}
                onClick={() => {
                  extendTimer();
                  close();
                }}
              >
                Give me 5 more minutes
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
