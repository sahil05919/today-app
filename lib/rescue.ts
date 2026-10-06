import { diffDays } from "./dates";
import { nextStep, remainingMinutes } from "./estimate";
import type { DurationModel } from "./stats";
import type { ISODate, Step, Task } from "./types";

export interface RescueItem {
  task: Task;
  minutes: number;
  guessed: boolean;
  /** Minutes come from your own timer history. */
  learned?: boolean;
  /** Set when the whole task doesn't fit but its next step does. */
  partial?: Step;
}

export function priorityScore(t: Task, today: ISODate): number {
  let s = 10;
  if (t.due) {
    const d = diffDays(t.due, today);
    if (d < 0) s = 100 + Math.min(-d, 10);
    else if (d === 0) s = 90;
    else if (d === 1) s = 70;
    else if (d <= 7) s = 55 - d;
    else s = 20;
  }
  if (t.important) s += 25;
  if (t.focus) s += 15;
  return s;
}

/** Picks what fits into `available` minutes: most urgent / important first, then fills the gaps. */
export function planRescue(tasks: Task[], available: number, today: ISODate, model?: DurationModel) {
  const open = tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => priorityScore(b, today) - priorityScore(a, today) || a.createdAt - b.createdAt);

  const items: RescueItem[] = [];
  let left = available;
  for (const task of open) {
    if (left <= 0) break;
    const { minutes, guessed, learned } = remainingMinutes(task, model);
    if (minutes <= left) {
      items.push({ task, minutes, guessed, learned });
      left -= minutes;
      continue;
    }
    const step = nextStep(task);
    if (step && step.estimateMin != null && step.estimateMin <= left) {
      items.push({ task, minutes: step.estimateMin, guessed: false, partial: step });
      left -= step.estimateMin;
    }
  }
  return { items, used: available - left };
}
