"use client";
import { useEffect, useState } from "react";
import { cheerLine } from "@/lib/cheer";
import { buzz } from "@/lib/haptics";
import { actions, getData } from "@/lib/store";
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

/** Finishes whatever a non-task timer was on: "session:<area>:<date>", "chore:<id>:<date>" or "bill:<id>:<due>". */
function finishRef(ref: string) {
  const [kind, id, date] = ref.split(":");
  if (kind === "session") {
    if (!getData().sessions?.some((l) => l.areaId === id && l.date === date)) actions.toggleSession(id, date, "manual");
  } else if (kind === "chore") actions.setEntry(ref, "done");
  else if (kind === "bill") actions.completeBill(id, date);
}

/** The running timer (on a task, a session or a chore). Sits just above the input. */
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

  const elapsed = timer ? now - timer.startedAt : 0;
  const goalReached = !!timer?.goalMin && elapsed >= timer.goalMin * 60_000;
  // A quiet buzz once, when the small first push has been done.
  useEffect(() => {
    if (goalReached) buzz(30);
  }, [goalReached]);

  if (!timer || (!task && !timer.ref)) return null;
  const title = task?.title ?? timer.label ?? "Timer";

  const stop = () => {
    const logged = actions.stopTimer();
    if (logged) ctx.notify(`Logged ${logged.minutes} min on “${logged.task.title}”`);
  };

  const done = () => {
    if (task) {
      actions.stopTimer();
      completeWithToast(task, ctx);
    } else if (timer.ref) {
      const ref = timer.ref;
      actions.stopTimer();
      finishRef(ref);
      buzz(20);
      ctx.notify(cheerLine(ctx.profile.name, 1));
    }
  };

  return (
    <div className="anim-fade mb-2 flex items-center gap-2 rounded-2xl bg-accent px-3 py-2 text-accent-ink shadow-md" role="timer" aria-label="Focus timer">
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent-ink" />
      <button onClick={() => task && ctx.open(task.id)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block text-xs tabular-nums opacity-80">
          {fmt(elapsed)}
          {goalReached ? ` · ${timer.goalMin} minutes in. Keep going?` : ""}
        </span>
      </button>
      <button onClick={stop} aria-label="Stop and log time" className="flex h-11 items-center gap-1 rounded-xl bg-accent-ink/15 px-3 text-sm font-semibold">
        <StopIcon width={16} height={16} /> Stop
      </button>
      <button onClick={done} className="flex h-11 items-center rounded-xl bg-accent-ink px-3 text-sm font-semibold text-accent">
        Done
      </button>
    </div>
  );
}
