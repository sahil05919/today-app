"use client";
import { useRef, useState } from "react";
import { diffDays, formatMinutes, friendlyDate } from "@/lib/dates";
import { remainingMinutes, stepProgress } from "@/lib/estimate";
import { buzz } from "@/lib/haptics";
import { recurLabel } from "@/lib/recur";
import { actions } from "@/lib/store";
import type { Task } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { CheckIcon, TargetIcon } from "./icons";
import { Chip, type ViewCtx } from "./ui";

const THRESHOLD = 80; // px of swipe before it counts
const MAX_PULL = 130;

/** Completes / reopens a task with a short vibration and an Undo toast. */
export function completeWithToast(task: Task, ctx: ViewCtx) {
  const wasDone = task.status === "done";
  const next = actions.toggleDone(task.id);
  buzz(20);
  if (wasDone) {
    ctx.notify("Reopened");
    return;
  }
  ctx.notify(
    next?.due ? `Done. Next one: ${friendlyDate(next.due, ctx.today)}` : "Done. Nice one",
    () => actions.toggleDone(task.id),
  );
}

export function TaskCard({
  task,
  ctx,
  big = false,
  quickWhen = false,
}: {
  task: Task;
  ctx: ViewCtx;
  big?: boolean;
  /** Show a "Set date" button (used in Later, where tasks have no date yet). */
  quickWhen?: boolean;
}) {
  const done = task.status === "done";
  const prog = stepProgress(task);
  const overdue = !done && task.due != null && diffDays(task.due, ctx.today) < 0;
  const rem = remainingMinutes(task);
  const area = task.area ? ctx.profile.areas.find((a) => a.id === task.area) : undefined;

  // --- swipe: right = done, left = snooze -------------------------------
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const armed = useRef(false);
  const dxRef = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    swiped.current = false;
    armed.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (!dragging) {
      if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.5) {
        setDragging(true);
        swiped.current = true;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* mouse/touch already tracked; capture is only a nicety */
        }
      } else return;
    }
    // Done tasks can only be swiped right (to reopen); there's nothing to snooze.
    const v = Math.max(done ? 0 : -MAX_PULL, Math.min(MAX_PULL, ddx));
    dxRef.current = v;
    setDx(v);
    const isArmed = Math.abs(v) >= THRESHOLD;
    if (isArmed && !armed.current) buzz(8);
    armed.current = isArmed;
  };
  const endSwipe = (e: React.PointerEvent, cancelled: boolean) => {
    if (!start.current) return;
    start.current = null;
    if (!dragging) return;
    const v = dxRef.current;
    setDragging(false);
    setDx(0);
    dxRef.current = 0;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* pointer wasn't captured; nothing to release */
    }
    if (cancelled) return;
    if (v >= THRESHOLD) completeWithToast(task, ctx);
    else if (v <= -THRESHOLD && !done) {
      buzz(20);
      ctx.when(task.id, "snooze");
    }
  };

  const toggleFocus = () => {
    if (!actions.toggleFocus(task.id)) ctx.notify(`Focus holds ${MAX_FOCUS} things. Un-pin one first, that's the point.`);
  };

  const pad = big ? "py-2.5" : "py-1.5";

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-between px-5 text-sm font-semibold ${
          dx > 0 ? "bg-accent-soft text-accent" : dx < 0 ? "bg-warn-soft text-warn" : ""
        }`}
      >
        <span>{dx > 0 ? (done ? "Reopen" : "✓ Done") : ""}</span>
        <span>{dx < 0 ? "Snooze ⏰" : ""}</span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endSwipe(e, false)}
        onPointerCancel={(e) => endSwipe(e, true)}
        onClickCapture={(e) => {
          if (swiped.current) {
            e.stopPropagation();
            e.preventDefault();
            swiped.current = false;
          }
        }}
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform 0.2s ease-out" }}
        className={`relative flex touch-pan-y items-start gap-0.5 rounded-2xl border border-line bg-surface pl-1 pr-1.5 ${pad} ${done ? "opacity-60" : ""}`}
      >
        <button
          onClick={() => completeWithToast(task, ctx)}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          className="flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
              done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent hover:border-accent hover:text-accent/50"
            }`}
          >
            <CheckIcon width={14} height={14} />
          </span>
        </button>

        <button onClick={() => ctx.open(task.id)} className="min-h-11 min-w-0 flex-1 py-1.5 pl-1 text-left">
          <div className={`${big ? "text-[17px]" : "text-[15px]"} font-medium leading-snug ${done ? "line-through" : ""}`}>
            {task.important && <span className="mr-1 font-bold text-accent">!</span>}
            {task.title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {task.due && (
              <Chip tone={overdue ? "warn" : "plain"}>
                {friendlyDate(task.due, ctx.today)}
                {task.dueTime ? ` · ${task.dueTime}` : ""}
              </Chip>
            )}
            {task.slot && task.slot.date === ctx.today && !done && <Chip tone="accent">🕘 {task.slot.start}</Chip>}
            {task.recur && <Chip tone="accent">↻ {recurLabel(task.recur)}</Chip>}
            {area && (
              <Chip>
                {area.emoji} {area.name}
              </Chip>
            )}
            {!done && (
              <Chip>
                {rem.guessed ? "~" : ""}
                {formatMinutes(rem.minutes)}
              </Chip>
            )}
            {task.tags.map((t) => (
              <Chip key={t}>#{t}</Chip>
            ))}
            {big && !done && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.startTimer(task.id);
                  ctx.notify("Timer running. Go for it.");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    actions.startTimer(task.id);
                  }
                }}
                className="inline-flex min-h-8 items-center rounded-full bg-accent px-3 text-[11px] font-semibold text-accent-ink"
              >
                ▶ Start
              </span>
            )}
          </div>
          {prog.total > 0 && (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${prog.pct}%` }} />
              </div>
              <span className="text-[11px] tabular-nums text-muted">
                {prog.done}/{prog.total}
              </span>
            </div>
          )}
        </button>

        {!done && quickWhen && (
          <button
            onClick={() => ctx.when(task.id, "schedule")}
            className="my-1 flex h-11 shrink-0 items-center rounded-xl bg-accent-soft px-3.5 text-xs font-semibold text-accent"
          >
            Set date
          </button>
        )}
        {!done && !quickWhen && (
          <button
            onClick={toggleFocus}
            aria-label={task.focus ? "Remove from focus" : "Add to focus"}
            aria-pressed={task.focus}
            className="flex h-11 w-11 shrink-0 items-center justify-center"
          >
            <span className={`rounded-full p-1.5 ${task.focus ? "bg-accent-soft text-accent" : "text-muted/60"}`}>
              <TargetIcon width={20} height={20} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
