"use client";
import { useState } from "react";
import { addDays } from "@/lib/dates";
import { buzz } from "@/lib/haptics";
import { toHHMM } from "@/lib/profile";
import { actions, DO_NOW_MIN, getData, MAX_SNOOZES } from "@/lib/store";
import type { TLItem } from "@/lib/timeline";
import type { ISODate } from "@/lib/types";
import { entryKeyOf, skipItem, startItem } from "./itemActions";
import { btn, field, Sheet, type ViewCtx } from "./ui";

/** What is being snoozed: a task, or something else on the timeline (a session, a chore, a bill). */
export type SnoozeTarget = { kind: "task"; taskId: string } | { kind: "item"; item: TLItem; date: ISODate };

const snoozedCount = (t: SnoozeTarget, today: ISODate) => {
  const d = getData();
  if (t.kind === "task") return d.tasks.find((x) => x.id === t.taskId)?.snoozeCount ?? 0;
  return d.settings.snoozes?.[`${t.item.key}@${t.date}`] ?? 0;
};

/**
 * Snooze: in an hour, this evening, or tomorrow. Each item can be snoozed twice. The third time it asks you to decide
 * (do it now for 15 minutes / book a fixed slot / drop it), so nothing drifts for ever.
 */
export function SnoozeSheet({ target, ctx, onClose }: { target: SnoozeTarget; ctx: ViewCtx; onClose: () => void }) {
  const [decide, setDecide] = useState(() => snoozedCount(target, ctx.today) >= MAX_SNOOZES);
  const title = target.kind === "task" ? getData().tasks.find((t) => t.id === target.taskId)?.title ?? "" : target.item.title;
  const left = MAX_SNOOZES - snoozedCount(target, ctx.today);

  if (decide) return <DecisionSheet target={target} ctx={ctx} onClose={onClose} />;

  const snooze = (kind: "hour" | "evening" | "tomorrow") => {
    buzz(12);
    const now = new Date();
    if (target.kind === "task") {
      const res = actions.snoozeTask(target.taskId, kind, now);
      if (res === "decide") return setDecide(true);
      ctx.notify(kind === "hour" ? "Snoozed for an hour" : kind === "evening" ? "Snoozed to this evening" : "Snoozed to tomorrow");
      return onClose();
    }
    const { item, date } = target;
    const key = entryKeyOf(item, date);
    if (!key) return onClose();
    if (actions.snoozeItem(item.key, now.getTime(), date) === "decide") return setDecide(true);
    if (kind === "tomorrow") {
      actions.setEntry(key, "skip");
      ctx.notify(`${item.title}: not today`, () => actions.setEntry(key, null));
    } else {
      const mins = now.getHours() * 60 + now.getMinutes();
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, Math.ceil((kind === "hour" ? mins + 60 : Math.max(18 * 60, mins + 60)) / 5) * 5);
      actions.setEntry(key, "snooze", at.getTime());
      ctx.notify(`${item.title}: back at ${toHHMM(at.getHours() * 60 + at.getMinutes())}`, () => actions.setEntry(key, null));
    }
    onClose();
  };

  return (
    <Sheet title="Snooze until…" onClose={onClose}>
      <p className="-mt-1 mb-3 truncate text-sm text-muted">{title}</p>
      <div className="grid grid-cols-1 gap-2.5">
        {(
          [
            ["hour", "In an hour", "I'll move it later today"],
            ["evening", "This evening", "After your break"],
            ["tomorrow", "Tomorrow", "It comes first tomorrow"],
          ] as const
        ).map(([k, label, sub]) => (
          <button key={k} onClick={() => snooze(k)} className="flex min-h-16 flex-col items-start justify-center rounded-2xl border border-line bg-bg px-4 py-3 text-left transition active:scale-[0.98]">
            <span className="text-[15px] font-semibold">{label}</span>
            <span className="text-xs text-muted">{sub}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-muted">{left === 1 ? "One snooze left. After that we'll decide together." : `${left} snoozes left.`}</p>
    </Sheet>
  );
}

type Mode = "choose" | "slot" | "drop";

/** The third time: pick one of three ways forward. */
export function DecisionSheet({ target, ctx, onClose }: { target: SnoozeTarget; ctx: ViewCtx; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [date, setDate] = useState<ISODate>(addDays(ctx.today, 1));
  const [time, setTime] = useState("18:30");
  const task = target.kind === "task" ? getData().tasks.find((t) => t.id === target.taskId) : undefined;
  const title = task?.title ?? (target.kind === "item" ? target.item.title : "");

  const finish = (msg: string, undo?: () => void) => {
    ctx.notify(msg, undo);
    onClose();
  };

  const doNow = () => {
    if (target.kind === "task") actions.decideTask(target.taskId, "now");
    else {
      actions.clearSnoozes(target.item.key, target.date);
      startItem(target.item, ctx, DO_NOW_MIN);
      return onClose();
    }
    finish(`${DO_NOW_MIN} minutes. Just begin.`);
  };

  const slot = () => {
    if (target.kind === "task") actions.decideTask(target.taskId, "slot", { date, time });
    else {
      // A fixed slot for a session or chore is a block in your calendar; sessions flow around it.
      const it = target.item;
      const mins = it.end - it.start || 30;
      const end = toHHMM(Math.min(1439, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + mins));
      actions.addEvent({ title: it.title, due: date, important: false, tags: [], event: { start: time, end, countsFor: it.kind === "session" ? it.areaId : undefined } });
      actions.clearSnoozes(it.key, target.date);
      const key = entryKeyOf(it, target.date);
      if (key) actions.setEntry(key, "skip");
    }
    finish("Booked. It's in your day now.");
  };

  const drop = () => {
    if (target.kind === "task" && task) {
      const copy = task;
      actions.decideTask(target.taskId, "drop");
      return finish("Let go. One less thing.", () => actions.restore({ ...copy, snoozeCount: 0 }));
    }
    if (target.kind === "item") {
      actions.clearSnoozes(target.item.key, target.date);
      skipItem(target.item, ctx, target.date);
    }
    onClose();
  };

  return (
    <Sheet title="This one keeps slipping" onClose={onClose}>
      <p className="-mt-1 mb-1 text-[15px] font-medium">{title}</p>
      <p className="mb-4 text-sm text-muted">You've snoozed it twice. No judgement: let's just pick what happens to it.</p>

      {mode === "choose" && (
        <div className="space-y-2.5">
          <button className={`${btn.primary} min-h-14 w-full text-left`} onClick={doNow}>
            ▶ Do it now · {DO_NOW_MIN}-minute start
          </button>
          <button className={`${btn.soft} min-h-14 w-full text-left`} onClick={() => setMode("slot")}>
            📌 Schedule a fixed slot
          </button>
          <button className={`${btn.ghost} min-h-14 w-full text-left`} onClick={() => setMode("drop")}>
            🍂 Drop it
          </button>
        </div>
      )}

      {mode === "slot" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Pick a time and treat it like an appointment. Everything else moves around it.</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={date} min={ctx.today} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Date" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} aria-label="Time" />
          </div>
          <div className="flex gap-2">
            <button className={`${btn.primary} flex-1`} disabled={!date || !time} onClick={slot}>
              Book it
            </button>
            <button className={btn.ghost} onClick={() => setMode("choose")}>
              Back
            </button>
          </div>
        </div>
      )}

      {mode === "drop" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Letting go of something you're not going to do frees up headspace. You can undo it right after.</p>
          <div className="flex gap-2">
            <button className={`${btn.primary} flex-1`} onClick={drop}>
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
