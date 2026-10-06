"use client";
import { useMemo, useState } from "react";
import { formatMinutes, friendlyDate } from "@/lib/dates";
import { planRescue } from "@/lib/rescue";
import { buildDurationModel } from "@/lib/stats";
import { actions } from "@/lib/store";
import type { Task } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { btn, Chip, field, Sheet, type ViewCtx } from "./ui";

const PRESETS = [15, 30, 45, 60, 90, 120];

export function Rescue({ tasks, ctx, onClose }: { tasks: Task[]; ctx: ViewCtx; onClose: () => void }) {
  const [minutes, setMinutes] = useState(45);
  const model = useMemo(() => buildDurationModel(tasks), [tasks]);
  const plan = useMemo(() => planRescue(tasks, minutes, ctx.today, model), [tasks, minutes, ctx.today, model]);

  return (
    <Sheet title="Rescue my day" onClose={onClose}>
      <p className="-mt-1 mb-4 text-sm text-muted">Tell me how much time you've really got. I'll pick what fits.</p>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((m) => (
          <button
            key={m}
            onClick={() => setMinutes(m)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              minutes === m ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg text-ink"
            }`}
          >
            {formatMinutes(m)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={5}
          step={5}
          inputMode="numeric"
          value={minutes || ""}
          onChange={(e) => setMinutes(Math.max(0, Math.min(1440, parseInt(e.target.value, 10) || 0)))}
          className={`${field} w-28`}
          aria-label="Minutes available"
        />
        <span className="text-sm text-muted">minutes available</span>
      </div>

      <div className="mt-5">
        {plan.items.length ? (
          <>
            <ul className="space-y-2">
              {plan.items.map(({ task, minutes: m, guessed, learned, partial }) => (
                <li key={task.id} className="rounded-2xl border border-line bg-bg px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium leading-snug">
                        {task.important && <span className="mr-1 font-bold text-accent">!</span>}
                        {task.title}
                      </p>
                      {partial && <p className="mt-0.5 text-sm text-muted">Just the next step: {partial.title}</p>}
                      <div className="mt-1.5 flex gap-1.5">
                        {task.due && <Chip tone={task.due < ctx.today ? "warn" : "plain"}>{friendlyDate(task.due, ctx.today)}</Chip>}
                        {guessed && <Chip>estimated</Chip>}
                        {learned && <Chip tone="accent">your average</Chip>}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-accent">
                      {guessed ? "~" : ""}
                      {formatMinutes(m)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-center text-sm text-muted">
              {formatMinutes(plan.used)} of {formatMinutes(minutes)}
              {minutes - plan.used >= 5 ? `, ${formatMinutes(minutes - plan.used)} breathing room` : ""}
            </p>
            <button
              className={`${btn.primary} mt-4 w-full`}
              onClick={() => {
                actions.setFocusIds(plan.items.map((i) => i.task.id));
                ctx.notify(`Today's focus is set (up to ${MAX_FOCUS})`);
                onClose();
              }}
            >
              Make this my focus
            </button>
            {plan.items.length > MAX_FOCUS && (
              <p className="mt-2 text-center text-xs text-muted">The top {MAX_FOCUS} become your focus; the rest stay in your list.</p>
            )}
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">
            {tasks.some((t) => t.status === "open")
              ? "Nothing fits in that time yet. Try a little longer, or break a task into smaller steps."
              : "No open tasks. Enjoy the free time."}
          </p>
        )}
      </div>
    </Sheet>
  );
}
