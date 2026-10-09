import { addDays, fromISO } from "./dates";
import { countedByEvent, eventsOn } from "./fixed";
import { isOffDay } from "./offday";
import { sessionAreas, weekProgress, type ProgressRow } from "./sessions";
import type { AppData, ISODate } from "./types";

/**
 * Progress, in the simplest possible form: one number, a few dots, a streak, one kind sentence.
 */

/** "This week: 72%": sessions done against weekly targets (an area can't count past its own target). */
export function weeklyPercent(data: AppData, today: ISODate): { pct: number; done: number; target: number } {
  const rows = weekProgress(data, today);
  const target = rows.reduce((n, r) => n + r.target, 0);
  const done = rows.reduce((n, r) => n + Math.min(r.done, r.target), 0);
  return { pct: target ? Math.round((done / target) * 100) : 0, done, target };
}

/** "3/4" while working on it, "✓ 4/4" when the target is hit, "5/4 ⭐" with extras. */
export const countLabel = (row: ProgressRow) => (row.over > 0 ? `${row.done}/${row.target} ⭐` : row.finished ? `✓ ${row.done}/${row.target}` : `${row.done}/${row.target}`);

/** ●●●○ for "3 of 4". Capped at 10 dots so a big target still fits. */
export function dots(row: ProgressRow): { filled: number; total: number } {
  const total = Math.min(10, Math.max(1, row.target));
  return { filled: Math.min(total, row.done), total };
}

const hadSession = (data: AppData, date: ISODate) =>
  (data.sessions ?? []).some((l) => l.date === date) || sessionAreas(data).some((a) => countedByEvent(data, a.id, date));

/**
 * Days in a row with at least one session. Not breaking it: today before you've done anything (the day isn't over),
 * an off day, or a day blocked by an all-day event. Those neither add to it nor end it.
 */
export function streak(data: AppData, today: ISODate): { days: number; doneToday: boolean } {
  const neutral = (d: ISODate) => isOffDay(data, d) || eventsOn(data, d).some((e) => !e.start);
  const doneToday = hadSession(data, today);
  let days = doneToday ? 1 : 0;
  for (let i = 1; i < 400; i++) {
    const d = addDays(today, -i);
    if (hadSession(data, d)) days++;
    else if (!neutral(d)) break;
  }
  return { days, doneToday };
}

const LINES = {
  off: ["Rest is part of the plan.", "Easy day. One small thing is plenty.", "Recharge. You've earned it."],
  complete: ["Week complete. Enjoy the rest of it.", "Every target hit. Nicely done.", "All done for the week. Be proud of that."],
  strong: ["Strong week. Keep the rhythm going.", "Going well. Just keep it steady.", "A good pace this week."],
  some: ["Good momentum. One small session today.", "You're getting there. Keep it light.", "Steady progress. Pick the easy one next."],
  fresh: ["Fresh week. Small steps count.", "A new week. Start with the easiest session.", "Plenty of week left. One small session today."],
  low: ["A small start counts. Pick the easiest one.", "No rush. Even ten minutes is a win.", "One small session changes the day."],
} as const;

/** One short, kind line that changes daily (the same all day). Never preachy. */
export function encouragement(data: AppData, today: ISODate): string {
  const { pct } = weeklyPercent(data, today);
  const dow = (fromISO(today).getDay() + 6) % 7; // Mon = 0
  const day = Math.floor(Date.parse(today) / 86_400_000);
  const pick = (list: readonly string[]) => list[((day % list.length) + list.length) % list.length];
  if (isOffDay(data, today)) return pick(LINES.off);
  if (pct >= 100) return pick(LINES.complete);
  if (pct >= 70) return pick(LINES.strong);
  if (pct >= 35) return pick(LINES.some);
  return pick(dow <= 1 ? LINES.fresh : LINES.low);
}
