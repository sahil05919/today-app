import { addDays, fromISO } from "./dates";
import { weekProgress } from "./sessions";
import { weekStart } from "./stats";
import type { AppData, ISODate } from "./types";

/**
 * "On track" / "Slightly behind", judged against what's expected by today's weekday, not the raw total.
 * An area that may use weekends spreads its target over 7 days, others over the 5 weekdays. What counts as expected is
 * the share of the days that have already finished (today's own share isn't expected until the day is over).
 */
export interface Pace {
  status: "on-track" | "behind";
  label: "On track" | "Slightly behind";
  /** Sessions expected by now, and how many are done (each area capped at its own target). */
  expected: number;
  done: number;
}

/** A little slack: being short by less than one whole session still counts as on track. */
const SLACK = 1;

export function paceStatus(data: AppData, today: ISODate): Pace {
  const start = weekStart(today);
  const rows = weekProgress(data, today);
  let expected = 0;
  let done = 0;
  for (const r of rows) {
    const days = r.area.target!.weekends ? 7 : 5;
    let elapsed = 0;
    for (let d = start; d < today; d = addDays(d, 1)) {
      const dow = fromISO(d).getDay();
      if (r.area.target!.weekends || (dow >= 1 && dow <= 5)) elapsed++;
    }
    expected += (r.target * Math.min(elapsed, days)) / days;
    done += Math.min(r.done, r.target);
  }
  const behind = expected - done >= SLACK;
  return { status: behind ? "behind" : "on-track", label: behind ? "Slightly behind" : "On track", expected: Math.round(expected * 10) / 10, done };
}
