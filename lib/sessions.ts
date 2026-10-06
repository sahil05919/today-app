import { addDays } from "./dates";
import { countedByEvent } from "./fixed";
import { withDefaults } from "./profile";
import { weekStart } from "./stats";
import type { Area, AppData, DayEntry, ISODate, SessionLog } from "./types";

/** Keys for the done / skipped / snoozed log. */
export const sessionKey = (areaId: string, date: ISODate) => `session:${areaId}:${date}`;
export const choreKey = (id: string, date: ISODate) => `chore:${id}:${date}`;
export const wrapKey = (date: ISODate) => `wrap:${date}`;

export const entryFor = (log: DayEntry[] | undefined, key: string) => log?.find((e) => e.key === key);

/** Areas that have a weekly session target. */
export const sessionAreas = (data: AppData): Area[] => withDefaults(data.profile).areas.filter((a) => a.target);

/** The next session number for an area: "Power BI session 14" is 14. */
export function nextNumber(logs: SessionLog[] | undefined, areaId: string): number {
  return (logs ?? []).filter((l) => l.areaId === areaId).reduce((m, l) => Math.max(m, l.n), 0) + 1;
}

export const variantFor = (area: Area, n: number): string | undefined =>
  area.target?.variants?.length ? area.target.variants[(n - 1) % area.target.variants.length] : undefined;

export const sessionTitle = (area: Area, n: number, variant?: string) =>
  variant ? `${variant} · session ${n}` : `${area.name} session ${n}`;

export interface ProgressRow {
  area: Area;
  done: number;
  target: number;
  minutes: number;
  /** Last day a session was logged, if any. */
  last?: ISODate;
  /** Days since the last session (null = never). */
  daysSince: number | null;
}

/** Weekly progress per area (Monday to Sunday). */
export function weekProgress(data: AppData, today: ISODate): ProgressRow[] {
  const start = weekStart(today);
  const end = addDays(start, 6);
  const logs = data.sessions ?? [];
  return sessionAreas(data).map((area) => {
    const mine = logs.filter((l) => l.areaId === area.id);
    const week = mine.filter((l) => l.date >= start && l.date <= end);
    // Events that stand in for a session count once their day has come (an outing counts as the walk).
    const eventDays = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => d <= today && countedByEvent(data, area.id, d) && !week.some((l) => l.date === d));
    const last = mine.reduce<ISODate | undefined>((m, l) => (!m || l.date > m ? l.date : m), undefined);
    return {
      area,
      done: week.length + eventDays.length,
      target: area.target!.perWeek,
      minutes: week.reduce((n, l) => n + l.minutes, 0) + eventDays.length * area.target!.minutes,
      last,
      daysSince: last ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000) : null,
    };
  });
}
