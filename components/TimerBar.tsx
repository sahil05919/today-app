"use client";
import { useEffect, useState } from "react";
import { cheerLine } from "@/lib/cheer";
import { buzz } from "@/lib/haptics";
import { actions } from "@/lib/store";
import { clock, timerPhase } from "@/lib/timer";
import { completeTimer } from "@/lib/timerRun";
import type { AppData } from "@/lib/types";
import { completeWithToast } from "./TaskCard";
import { StopIcon } from "./icons";
import type { ViewCtx } from "./ui";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/**
 * The running timer (on a task, a session or a chore). Sits just above the input.
 * With a goal it counts down ("12:41 left") with a thin progress bar; without one it counts up.
 * Running out is handled by TimerWatcher, which is always mounted.
 */
export function TimerBar({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const timer = data.settings.timer;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const task = timer?.taskId ? data.tasks.find((t) => t.id === timer.taskId) : undefined;
  const orphaned = !!timer && !!timer.taskId && !task;

  // The task was deleted while timing: clear the timer.
  useEffect(() => {
    if (orphaned) actions.discardTimer();
  }, [orphaned]);

  if (!timer || (!task && !timer.ref)) return null;
  const title = task?.title ?? timer.label ?? "Timer";
  const ph = timerPhase(timer, now);
  const left = ph.phase === "running" ? ph.leftMs : undefined;

  const stop = () => {
    const logged = actions.stopTimer();
    if (logged) ctx.notify(`Logged ${logged.minutes} min on “${logged.task.title}”`);
  };

  const done = () => {
    if (task) {
      actions.stopTimer();
      completeWithToast(task, ctx);
    } else if (timer.ref) {
      completeTimer();
      buzz(20);
      ctx.notify(cheerLine(ctx.profile.name, 1));
    }
  };

  return (
    <div className="anim-fade mb-2 overflow-hidden rounded-2xl bg-accent text-accent-ink shadow-md" role="timer" aria-label="Focus timer">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent-ink" />
        <button onClick={() => task && ctx.open(task.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="block text-xs tabular-nums opacity-80">{left != null ? `${clock(left)} left` : fmt(ph.elapsedMs)}</span>
        </button>
        <button onClick={stop} aria-label="Stop and log time" className="flex h-11 items-center gap-1 rounded-xl bg-accent-ink/15 px-3 text-sm font-semibold">
          <StopIcon width={16} height={16} /> Stop
        </button>
        <button onClick={done} className="flex h-11 items-center rounded-xl bg-accent-ink px-3 text-sm font-semibold text-accent">
          Done
        </button>
      </div>
      {ph.phase === "running" && ph.progress != null && (
        <div className="h-1 bg-accent-ink/15" aria-hidden="true">
          <div className="h-full bg-accent-ink/70 transition-all duration-1000 ease-linear" style={{ width: `${Math.min(100, ph.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
