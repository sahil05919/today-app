import { buzz } from "@/lib/haptics";
import { cheerLine } from "@/lib/cheer";
import { toISO } from "@/lib/dates";
import { choreKey } from "@/lib/sessions";
import { actions, getData } from "@/lib/store";
import { timerGoal } from "@/lib/timer";
import type { TLItem } from "@/lib/timeline";
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

/** Ticks an item off. `left` = how many other things are still open (for the closing line). */
export function completeItem(it: TLItem, ctx: ViewCtx, date: ISODate, left: number) {
  const line = () => cheerLine(ctx.profile.name, left);
  buzz(20);
  if (it.kind === "task" && it.taskId) {
    const t = getData().tasks.find((x) => x.id === it.taskId);
    if (!t) return;
    // A running timer on it stops with it.
    if (getData().settings.timer?.taskId === t.id) actions.stopTimer();
    actions.toggleDone(t.id);
    ctx.notify(line(), () => actions.toggleDone(t.id));
  } else if (it.kind === "session" && it.areaId) {
    if (!getData().sessions?.some((l) => l.areaId === it.areaId && l.date === date)) actions.toggleSession(it.areaId, date, "manual");
    const area = it.areaId;
    ctx.notify(`${it.title} counted. ${line()}`, () => actions.toggleSession(area, date, "manual"));
    stopTimerFor(it);
  } else if (it.kind === "chore" && it.choreId) {
    const key = choreKey(it.choreId, date);
    actions.setEntry(key, "done");
    ctx.notify(line(), () => actions.setEntry(key, null));
    stopTimerFor(it);
  } else if (it.kind === "bill" && it.bill) {
    const bill = getData().bills?.find((b) => b.id === it.bill!.id);
    const prev = bill?.lastDone;
    actions.completeBill(it.bill.id, it.bill.due);
    const { id, due } = it.bill;
    ctx.notify(line(), () => actions.uncompleteBill(id, due, prev));
    stopTimerFor(it);
  }
}

/** Takes a ticked item back. */
export function undoItem(it: TLItem, ctx: ViewCtx, date: ISODate) {
  if (it.kind === "task" && it.taskId) actions.toggleDone(it.taskId);
  else if (it.kind === "session" && it.areaId) {
    if (getData().sessions?.some((l) => l.areaId === it.areaId && l.date === date)) actions.toggleSession(it.areaId, date);
  } else if (it.kind === "chore" && it.choreId) actions.setEntry(choreKey(it.choreId, date), null);
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
