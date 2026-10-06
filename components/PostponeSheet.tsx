"use client";
import { useState } from "react";
import { addDays } from "@/lib/dates";
import { downloadICS } from "@/lib/ics";
import { actions } from "@/lib/store";
import type { Task } from "@/lib/types";
import { btn, field, Sheet, type ViewCtx } from "./ui";

type Mode = "choose" | "step" | "slot" | "drop";

/** Shown after a task's date has been pushed back 3 times. Gentle, with three ways forward. */
export function PostponeSheet({ task, ctx, onClose }: { task: Task; ctx: ViewCtx; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [step, setStep] = useState("");
  const [date, setDate] = useState(addDays(ctx.today, 1));
  const [time, setTime] = useState("09:00");
  const reset = { snoozeCount: 0 };

  const finish = (msg: string, undo?: () => void) => {
    ctx.notify(msg, undo);
    onClose();
  };

  const setSlot = (calendar: boolean) => {
    actions.update(task.id, { due: date, dueTime: time, ...reset });
    if (calendar) downloadICS({ ...task, due: date, dueTime: time });
    finish(calendar ? "Slot set. Add the downloaded file to your calendar." : "Slot set. It's in your diary now.");
  };

  return (
    <Sheet title="This one keeps slipping" onClose={onClose}>
      <p className="-mt-1 mb-1 text-[15px] font-medium">{task.title}</p>
      <p className="mb-4 text-sm text-muted">
        You've moved it a few times. That's not a failing: it usually means it's too big, or it has no real time. What would help?
      </p>

      {mode === "choose" && (
        <div className="space-y-2.5">
          <button className={`${btn.soft} min-h-14 w-full text-left`} onClick={() => setMode("step")}>
            🪜 Break it into small steps
          </button>
          <button className={`${btn.soft} min-h-14 w-full text-left`} onClick={() => setMode("slot")}>
            📌 Give it a fixed slot
          </button>
          <button className={`${btn.ghost} min-h-14 w-full text-left`} onClick={() => setMode("drop")}>
            🍂 Let it go
          </button>
          <button
            className={`${btn.link} block w-full pt-1 text-center`}
            onClick={() => {
              actions.update(task.id, reset);
              onClose();
            }}
          >
            Keep it as it is
          </button>
        </div>
      )}

      {mode === "step" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const title = step.trim();
            if (!title) return;
            actions.addStep(task.id, title, undefined, true);
            actions.update(task.id, reset);
            finish("Added a first step. Small beats perfect.");
          }}
        >
          <label className="block text-sm font-medium" htmlFor="first-step">
            What's the very first small thing? (even “open the document”)
          </label>
          <input id="first-step" autoFocus value={step} onChange={(e) => setStep(e.target.value)} className={field} />
          <div className="flex gap-2">
            <button type="submit" disabled={!step.trim()} className={`${btn.primary} flex-1`}>
              Add step
            </button>
            <button
              type="button"
              className={btn.ghost}
              onClick={() => {
                actions.update(task.id, reset);
                onClose();
                ctx.open(task.id);
              }}
            >
              More steps…
            </button>
          </div>
        </form>
      )}

      {mode === "slot" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Pick a time and treat it like an appointment.</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={date} min={ctx.today} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Date" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} aria-label="Time" />
          </div>
          <div className="flex gap-2">
            <button className={`${btn.primary} flex-1`} disabled={!date || !time} onClick={() => setSlot(false)}>
              Set slot
            </button>
            <button className={`${btn.soft} flex-1`} disabled={!date || !time} onClick={() => setSlot(true)}>
              + Calendar file
            </button>
          </div>
        </div>
      )}

      {mode === "drop" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Dropping something you're not going to do frees up headspace. You can undo this right after.</p>
          <div className="flex gap-2">
            <button
              className={`${btn.primary} flex-1`}
              onClick={() => {
                const copy = task;
                actions.remove(task.id);
                finish("Let go. One less thing.", () => actions.restore({ ...copy, snoozeCount: 0 }));
              }}
            >
              Yes, drop it
            </button>
            <button className={btn.ghost} onClick={() => setMode("choose")}>
              Back
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
