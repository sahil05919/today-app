import { actions, getData } from "./store";
import { extendedGoal } from "./timer";

/** Finishes whatever a non-task timer was on: "session:<area>:<date>", "chore:<id>:<date>" or "bill:<id>:<due>". */
export function finishRef(ref: string) {
  const [kind, id, date] = ref.split(":");
  if (kind === "session") {
    if (!getData().sessions?.some((l) => l.areaId === id && l.date === date)) actions.toggleSession(id, date, "manual");
  } else if (kind === "chore") actions.setEntry(ref, "done");
  else if (kind === "bill") actions.completeBill(id, date);
}

/**
 * The timer ran out (or Done was pressed): stop it and count what it was on.
 * A task gets its time logged and is completed; a session / chore / bill is counted via `finishRef`.
 * Returns false when there was no timer.
 */
export function completeTimer(): boolean {
  const timer = getData().settings.timer;
  if (!timer) return false;
  if (timer.taskId) {
    const id = timer.taskId;
    actions.stopTimer();
    const t = getData().tasks.find((x) => x.id === id);
    if (t && t.status === "open") actions.toggleDone(id);
  } else {
    actions.stopTimer();
    if (timer.ref) finishRef(timer.ref);
  }
  return true;
}

/** "+5 min" from a notification button or the Time's up card. */
export function extendTimer(now = Date.now()): boolean {
  const timer = getData().settings.timer;
  if (!timer) return false;
  actions.settings({ timer: { ...timer, goalMin: extendedGoal(timer, now) } });
  return true;
}

/** Buttons on the "time's up" notification. Returns false when the action isn't one of ours. */
export function applyTimerAction(actionId: string, now = Date.now()): boolean {
  if (actionId === "done") {
    completeTimer();
    return true;
  }
  if (actionId === "extend") {
    extendTimer(now);
    return true;
  }
  return false;
}
