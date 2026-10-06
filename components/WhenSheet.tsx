"use client";
import { useState } from "react";
import { friendlyDate } from "@/lib/dates";
import { buzz } from "@/lib/haptics";
import { laterTodayTime, WHEN_LABEL, whenDate, type WhenKind } from "@/lib/snooze";
import { actions } from "@/lib/store";
import type { ISODate, Task } from "@/lib/types";
import { btn, field, Sheet, type ViewCtx } from "./ui";

/** One-tap snooze (mode "snooze") or "when?" for tasks with no date (mode "schedule"). */
export function WhenSheet({
  task,
  mode,
  ctx,
  onClose,
}: {
  task: Task;
  mode: "snooze" | "schedule";
  ctx: ViewCtx;
  onClose: () => void;
}) {
  const [pick, setPick] = useState("");
  const kinds: WhenKind[] =
    mode === "snooze" ? ["later-today", "tomorrow", "weekend", "next-week"] : ["today", "tomorrow", "weekend", "next-week"];

  const apply = (due: ISODate, kind?: WhenKind) => {
    const prev = { due: task.due, dueTime: task.dueTime, focus: task.focus };
    const patch: Partial<Task> = {
      due,
      dueTime: kind === "later-today" ? (task.dueTime ? laterTodayTime() : undefined) : task.dueTime,
      // Anything moved off today (or "later today") leaves the focus list so it stops nagging.
      focus: due === ctx.today && kind !== "later-today" ? task.focus : false,
    };
    actions.update(task.id, patch);
    buzz(15);
    ctx.notify(
      `${mode === "snooze" ? "Snoozed" : "Set"} for ${friendlyDate(due, ctx.today).toLowerCase()}`,
      () => actions.update(task.id, prev),
    );
    onClose();
  };

  return (
    <Sheet title={mode === "snooze" ? "Snooze until…" : "When?"} onClose={onClose}>
      <p className="-mt-1 mb-3 truncate text-sm text-muted">{task.title}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {kinds.map((k) => {
          const d = whenDate(k);
          return (
            <button
              key={k}
              onClick={() => apply(d, k)}
              className="flex min-h-16 flex-col items-start justify-center rounded-2xl border border-line bg-bg px-4 py-3 text-left transition active:scale-[0.98]"
            >
              <span className="text-[15px] font-semibold">{WHEN_LABEL[k]}</span>
              <span className="text-xs text-muted">{k === "later-today" ? "Back this evening" : friendlyDate(d, ctx.today)}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input type="date" value={pick} min={ctx.today} onChange={(e) => setPick(e.target.value)} className={field} aria-label="Pick a date" />
        <button className={btn.primary} disabled={!pick} onClick={() => apply(pick)}>
          Set
        </button>
      </div>
    </Sheet>
  );
}
