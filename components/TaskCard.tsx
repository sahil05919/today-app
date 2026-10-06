"use client";
import { diffDays, formatMinutes, friendlyDate } from "@/lib/dates";
import { remainingMinutes, stepProgress } from "@/lib/estimate";
import { actions } from "@/lib/store";
import type { Task } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { CheckIcon, TargetIcon } from "./icons";
import { Chip, type ViewCtx } from "./ui";

export function TaskCard({
  task,
  ctx,
  big = false,
  quickToday = false,
}: {
  task: Task;
  ctx: ViewCtx;
  big?: boolean;
  /** Show a "Today" button (used in Later to pull something forward). */
  quickToday?: boolean;
}) {
  const done = task.status === "done";
  const prog = stepProgress(task);
  const overdue = !done && task.due != null && diffDays(task.due, ctx.today) < 0;
  const rem = remainingMinutes(task);

  const toggleFocus = () => {
    if (!actions.toggleFocus(task.id)) ctx.notify(`Focus holds ${MAX_FOCUS} things. Un-pin one first, that's the point.`);
  };
  const pullToday = () => {
    actions.setDue(task.id, ctx.today, task.dueTime);
    if (!actions.toggleFocus(task.id)) ctx.notify("Moved to today (focus is full, so it's in the list below).");
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-line bg-surface ${big ? "p-4" : "px-3.5 py-3"} ${done ? "opacity-60" : ""}`}
    >
      <button
        onClick={() => actions.toggleDone(task.id)}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
          done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent hover:border-accent hover:text-accent/50"
        }`}
      >
        <CheckIcon width={14} height={14} />
      </button>

      <button onClick={() => ctx.open(task.id)} className="min-w-0 flex-1 text-left">
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
          {!done && <Chip>{rem.guessed ? "~" : ""}{formatMinutes(rem.minutes)}</Chip>}
          {task.tags.map((t) => (
            <Chip key={t}>#{t}</Chip>
          ))}
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

      {!done && quickToday && (
        <button onClick={pullToday} className="shrink-0 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent">
          Today
        </button>
      )}
      {!done && !quickToday && (
        <button
          onClick={toggleFocus}
          aria-label={task.focus ? "Remove from focus" : "Add to focus"}
          aria-pressed={task.focus}
          className={`-mr-1 mt-0.5 shrink-0 rounded-full p-1.5 ${task.focus ? "bg-accent-soft text-accent" : "text-muted/60 hover:text-accent"}`}
        >
          <TargetIcon width={18} height={18} />
        </button>
      )}
    </div>
  );
}
