import { buzz } from "@/lib/haptics";
import { cheerLine } from "@/lib/cheer";
import { toISO } from "@/lib/dates";
import { choreKey } from "@/lib/sessions";
import { actions, getData } from "@/lib/store";
import { timerGoal } from "@/lib/timer";
import type { TLItem } from "@/lib/timeline";
import { whenFor, type DoneTarget, type DoneWhen } from "@/lib/done";
import type { ISODate } from "@/lib/types";
import type { ViewCtx } from "./ui";

/**
 * What Done / Undo / Skip / Start mean for each kind of timeline item. One place, so the Next up card, the rows and
 * the detail sheet all behave the same way. Every completion gives a small vibration and a short, warm line.
 */
export function entryKeyOf(it: TLItem, date: ISODate): string | null {
  if (it.kind === "session") return it.sessionKey ?? null;
  if (it.kind === "chore" && it.choreId) return choreKey(it.choreId, date);
  if (it.kind === "bill" && it.bill) return it.bill.key;
  return null;
}

/** Items still open today, not counting `except`. Used so the line can say "All done for today". */
export const openCount = (items: TLItem[], except?: string) =>
  items.filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay && x.kind !== "event" && x.kind !== "calendar" && x.key !== except).length;

/** What a timeline item is, as a target for the shared tick (lib/done.ts). */
export function doneTargetOf(it: TLItem, date: ISODate): DoneTarget | null {
  if (it.kind === "session" && it.areaId) return { kind: "session", areaId: it.areaId, date };
  if (it.kind === "chore" && it.choreId) return { kind: "rhythm", id: it.choreId, date };
  if (it.kind === "bill" && it.bill) return { kind: "bill", id: it.bill.id, due: it.bill.due };
  if (it.kind === "task" && it.taskId) return { kind: "task", id: it.taskId };
  return null;
}

/** The toast after a tick: what happened, plus the celebration if a weekly target was just reached. */
export function tickToast(r: ReturnType<typeof actions.markDone>, ctx: ViewCtx, cheer?: string): string {
  const names = r.reached.map((id) => ctx.profile.areas.find((a) => a.id === id)?.name).filter(Boolean);
  const hit = names.length ? ` ${names.join(" and ")} done for the week 🎉, ${ctx.profile.name || "friend"}.` : "";
  return `${r.message}${r.noop || r.early || !cheer ? "" : `. ${cheer}`}${hit}`;
}

/**
 * Ticks an item off, on whatever day it is shown. `left` = how many other things are still open (for the closing line).
 * `when` defaults to the item's own day (today), "I did this early" for a future day, "I did it" for a missed one.
 */
export function completeItem(it: TLItem, ctx: ViewCtx, date: ISODate, left: number, opts: { when?: DoneWhen; extra?: boolean } = {}) {
  const line = () => cheerLine(ctx.profile.name, left);
  buzz(20);
  if (it.kind === "task" && it.taskId && date === ctx.today) {
    const t = getData().tasks.find((x) => x.id === it.taskId);
    if (!t) return;
    // A running timer on it stops with it.
    if (getData().settings.timer?.taskId === t.id) actions.stopTimer();
    actions.toggleDone(t.id);
    ctx.notify(line(), () => actions.toggleDone(t.id));
    return;
  }
  const target = doneTargetOf(it, date);
  if (!target) return;
  if (target.kind === "task" && getData().settings.timer?.taskId === target.id) actions.stopTimer();
  const r = actions.markDone(target, { when: opts.when ?? whenFor(date, ctx.today), extra: opts.extra });
  ctx.notify(tickToast(r, ctx, date === ctx.today ? line() : undefined), r.noop ? undefined : () => actions.undoDone(r.receipt));
  stopTimerFor(it);
}

/** Takes a ticked item back. A session: only the one session you meant (never "whatever is on that day"). */
export function undoItem(it: TLItem, ctx: ViewCtx, date: ISODate) {
  if (it.kind === "task" && it.taskId) actions.toggleDone(it.taskId);
  else if (it.kind === "session" && it.logId) actions.removeSession(it.logId);
  else if (it.kind === "chore" && it.choreId) actions.setEntry(choreKey(it.choreId, date), null);
  ctx.notify("Back on the list");
}

export function skipItem(it: TLItem, ctx: ViewCtx, date: ISODate) {
  const key = entryKeyOf(it, date);
  if (!key) return;
  actions.setEntry(key, "skip");
  ctx.notify(`Skipped ${it.title}`, () => actions.setEntry(key, null));
}

export function unskipItem(it: TLItem, date: ISODate) {
  const key = entryKeyOf(it, date);
  if (key) actions.setEntry(key, null);
}

/** Start: a task gets the focus timer; a session or chore gets a timer too, so Done can follow. */
export function startItem(it: TLItem, ctx: ViewCtx, goalMin?: number) {
  buzz(12);
  // The timer runs for the planned time (Meditation 15, Power BI 60…), and stops itself there.
  const goal = goalMin ?? timerGoal(getData(), it);
  if (it.kind === "task" && it.taskId) actions.startTimer(it.taskId, goal);
  else actions.startItemTimer(entryKeyOf(it, toISO(new Date())) ?? it.key, it.title, goal);
  ctx.notify(goal ? `${goal} minutes. Just begin.` : "Timer running. Go for it.");
}

function stopTimerFor(it: TLItem) {
  const t = getData().settings.timer;
  if (!t || t.taskId) return;
  if (t.ref === (entryKeyOf(it, toISO(new Date())) ?? it.key)) actions.stopTimer();
}
