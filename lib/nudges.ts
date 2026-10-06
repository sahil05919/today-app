import { billReminders } from "./bills";
import { addDays, fromISO, toISO } from "./dates";
import { eventsOn } from "./fixed";
import { planSessions, plannedForDay } from "./schedule";
import { entryFor, weekProgress } from "./sessions";
import type { AppData, ISODate } from "./types";

/**
 * The "conscience": gentle, specific nudges that notice what's missing rather than asking you to track more.
 *   - behind:    a weekly target you can no longer fully reach
 *   - neglect:   an area with no session for longer than usual
 *   - empty-day: tomorrow has nothing in it
 *   - goals:     the new month has no must-haves yet
 * Most important first. A nudge you dismiss stays quiet for the day.
 */
export interface Nudge {
  id: string;
  kind: "behind" | "neglect" | "empty-day" | "goals";
  text: string;
  areaId?: string;
}

export const nudgeKey = (id: string, date: ISODate) => `nudge:${id}:${date}`;

/** "No meditation in 5 days": how many days is too many, from how often you meant to do it. */
export const neglectAfter = (perWeek: number) => Math.max(3, Math.ceil(14 / perWeek));

const isWeekend = (d: ISODate) => [0, 6].includes(fromISO(d).getDay());

export function computeNudges(data: AppData, now: Date = new Date()): Nudge[] {
  const today = toISO(now);
  const out: Nudge[] = [];
  const dismissed = (id: string) => entryFor(data.log, nudgeKey(id, today))?.status === "skip";

  // --- Behind on a weekly target: what's done plus what still fits is short of the goal -----------
  const future = planSessions(data, now).filter((s) => !s.done);
  const rows = weekProgress(data, today);
  // Not before Wednesday: a missed Monday is normal, and the plan has days left to absorb it.
  const dayOfWeek = (fromISO(today).getDay() + 6) % 7; // Mon = 0
  const behind =
    dayOfWeek < 2
      ? []
      : rows
          .map((r) => ({ r, fit: future.filter((s) => s.areaId === r.area.id).length }))
          .map((x) => ({ ...x, short: x.r.target - x.r.done - x.fit }))
          .filter((x) => x.short > 0)
          .sort((a, b) => b.short - a.short);
  for (const { r, fit } of behind) {
    out.push({
      id: `behind:${r.area.id}`,
      kind: "behind",
      areaId: r.area.id,
      text:
        fit === 0
          ? `${r.area.name} is behind: ${r.done} of ${r.target} so far, and nothing more fits this week. Worth moving something?`
          : `${r.area.name} is a little behind: ${r.done} of ${r.target} so far, and only ${fit} more ${fit === 1 ? "fits" : "fit"} this week.`,
    });
  }

  // --- Neglected: longer than usual since the last one ---------------------------------------------
  const since = (areaId: string, last?: ISODate, weekends = true) => {
    // Never look back more than 60 days (an old or odd first-run date shouldn't cost anything).
    const floor = addDays(today, -60);
    const start = last ?? toISO(new Date(data.settings.firstRunAt));
    const from = start < floor ? floor : start;
    let n = 0;
    for (let d = addDays(from, 1); d <= today; d = addDays(d, 1)) if (weekends || !isWeekend(d)) n++;
    return n;
  };
  const neglected = rows
    .map((r) => {
      const days = since(r.area.id, r.last, r.area.target!.weekends);
      return { r, days, limit: neglectAfter(r.area.target!.perWeek) };
    })
    .filter((x) => x.days >= x.limit && !behind.some((b) => b.r.area.id === x.r.area.id))
    .sort((a, b) => b.days / b.limit - a.days / a.limit);
  for (const { r, days } of neglected) {
    out.push({
      id: `neglect:${r.area.id}`,
      kind: "neglect",
      areaId: r.area.id,
      text: r.last ? `No ${r.area.name.toLowerCase()} in ${days} days.` : `No ${r.area.name.toLowerCase()} session yet.`,
    });
  }

  // --- Empty tomorrow (weekends are meant to be light, so they're left alone) ----------------------
  const tomorrow = addDays(today, 1);
  if (!isWeekend(tomorrow)) {
    const busyTomorrow =
      plannedForDay(data, tomorrow).length > 0 ||
      eventsOn(data, tomorrow).length > 0 ||
      data.tasks.some((t) => t.status === "open" && t.due === tomorrow) ||
      billReminders(data, tomorrow, tomorrow, today).length > 0;
    if (!busyTomorrow) out.push({ id: "empty-day", kind: "empty-day", text: "Tomorrow looks empty. Want to add a session?" });
  }

  // --- New month, no must-haves yet ------------------------------------------------------------------
  const month = today.slice(0, 7);
  if (fromISO(today).getDate() <= 5 && data.goals?.month !== month) {
    out.push({ id: "goals", kind: "goals", text: "New month. What are your must-haves?" });
  }

  return out.filter((n) => !dismissed(n.id));
}
