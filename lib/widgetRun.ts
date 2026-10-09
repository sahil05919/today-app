import { actions, getData } from "./store";
import { finishRef } from "./timerRun";
import type { WidgetAction } from "./widget";

/**
 * Applies a Done that was tapped on the home-screen widget, through the same actions the app itself uses, so a session
 * is counted ("Power BI session 14"), a bill is marked paid and a task is completed with its recurrence handled.
 * Already done by the time we get here? Then it is a no-op, never an undo.
 */
export function applyWidgetAction(a: WidgetAction): boolean {
  if (a.type !== "done") return false;
  if (a.kind === "task") {
    const t = a.taskId ? getData().tasks.find((x) => x.id === a.taskId) : undefined;
    if (!t || t.status !== "open") return false;
    if (getData().settings.timer?.taskId === t.id) actions.stopTimer();
    actions.toggleDone(t.id);
    return true;
  }
  if (!a.ref) return false;
  // A running timer on this very item stops with it.
  if (getData().settings.timer?.ref === a.ref) actions.stopTimer();
  finishRef(a.ref);
  return true;
}

export function applyWidgetActions(list: WidgetAction[]): number {
  let n = 0;
  for (const a of list) if (applyWidgetAction(a)) n++;
  return n;
}
