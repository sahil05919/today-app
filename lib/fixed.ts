import { toMin, withDefaults } from "./profile";
import type { Area, AppData, FixedEvent, ISODate } from "./types";

/**
 * Fixed events ("event Wednesday 6pm dinner") are blocks that never move. Sessions flow around them.
 * An event with no time blocks the whole day.
 */
export const DEFAULT_EVENT_MINUTES = 120;

export const eventsOn = (data: AppData, date: ISODate): FixedEvent[] =>
  (data.events ?? []).filter((e) => e.date === date).sort((a, b) => (a.start ?? "00:00").localeCompare(b.start ?? "00:00"));

/** [start, end) in minutes after midnight. */
export function eventSpan(e: FixedEvent): [number, number] {
  if (!e.start) return [0, 1440];
  const s = toMin(e.start);
  const end = e.end ? toMin(e.end) : s + DEFAULT_EVENT_MINUTES;
  return [s, Math.max(end, s + 15)];
}

/** What the planner treats as busy on each day. */
export function eventBusy(data: AppData): (date: ISODate) => Array<[number, number]> {
  const byDate = new Map<ISODate, Array<[number, number]>>();
  for (const e of data.events ?? []) {
    const list = byDate.get(e.date) ?? [];
    list.push(eventSpan(e));
    byDate.set(e.date, list);
  }
  return (date) => byDate.get(date) ?? [];
}

/** Dates (this week or any) on which an event counts as a session for an area. */
export const countedByEvent = (data: AppData, areaId: string, date: ISODate) =>
  (data.events ?? []).some((e) => e.date === date && e.countsFor === areaId);

const COUNTS_AS: Array<[areaId: string, pattern: RegExp]> = [["walking", /\b(walk|walking|outing|hike|stroll|trek|park)\b/i]];

/** A weekend outing counts as the walk: guess which area an event stands in for, from its title. */
export function inferCountsFor(title: string, areas: Area[]): string | undefined {
  const have = new Set(areas.filter((a) => a.target).map((a) => a.id));
  for (const [id, re] of COUNTS_AS) if (have.has(id) && re.test(title)) return id;
  return undefined;
}

/** Minutes before an event to remind you. */
export const eventLead = (data: AppData) => withDefaults(data.profile).eventLeadMin;
