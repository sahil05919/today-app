import sources from "./side-work-sources.json";
import { weekStart } from "./stats";
import type { AppData, ISODate, SideWorkState } from "./types";

/**
 * Side work: the Monday check. A checklist in three groups:
 *   - Every week: the sources you check each week (starred ones join it),
 *   - This week's 5: a rotating set (from 15 Oct to 15 Dec the "Christmas & seasonal" group comes first),
 *   - All sources: searchable, each can be starred or hidden.
 * Each source opens a web search for "<name> London jobs", so a link never goes stale. The list is data (side-work-sources.json),
 * and your own additions are kept with your data.
 */
export interface Source {
  id: string;
  name: string;
  group: string;
  groupName: string;
  seasonal: boolean;
  custom?: boolean;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "source";

const BUILT_IN: Source[] = sources.groups.flatMap((g) => g.sources.map((name) => ({ id: slug(name), name, group: g.id, groupName: g.name, seasonal: !!(g as { seasonal?: boolean }).seasonal })));

export const DEFAULT_WEEKLY: string[] = sources.weekly.map(slug);

export const stateOf = (d: AppData): SideWorkState => d.sideWork ?? { weekly: DEFAULT_WEEKLY, hidden: [], custom: [], checks: {} };

/** Every source: the built-in list plus your own, in group order. */
export function allSources(d: AppData): Source[] {
  const st = stateOf(d);
  const custom: Source[] = st.custom.map((c) => ({ id: c.id, name: c.name, group: "mine", groupName: "Mine", seasonal: false, custom: true }));
  // The same source can sit in two groups (King's Talent Bank is in "Uni" and "Every week"): it is listed once.
  const seen = new Set<string>();
  return [...BUILT_IN, ...custom].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** 15 Oct to 15 Dec: the run-up to Christmas, when seasonal work is advertised. */
export function inSeason(date: ISODate): boolean {
  const md = date.slice(5);
  return md >= "10-15" && md <= "12-15";
}

const weekIndex = (date: ISODate) => Math.floor((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000 + 3) / 7);

/** `n` consecutive items from `list`, starting at a spot that moves on every week, so all of it is covered over time. */
function rotate<T>(list: T[], n: number, week: number): T[] {
  if (!list.length) return [];
  const take = Math.min(n, list.length);
  const start = (week * n) % list.length;
  return Array.from({ length: take }, (_, i) => list[(start + i) % list.length]);
}

export function weeklySources(d: AppData): Source[] {
  const by = new Map(allSources(d).map((s) => [s.id, s]));
  return stateOf(d)
    .weekly.map((id) => by.get(id))
    .filter((s): s is Source => !!s);
}

/**
 * This week's 5: sources that are not in "Every week" and not hidden, rotating week by week. In the run-up to Christmas (15 Oct
 * to 15 Dec) three of the five come from "Christmas & seasonal" and two from the rest; the rest of the year seasonal work is left out.
 */
export function thisWeeksFive(d: AppData, date: ISODate): Source[] {
  const st = stateOf(d);
  const week = weekIndex(weekStart(date));
  const pool = allSources(d).filter((s) => !st.weekly.includes(s.id) && !st.hidden.includes(s.id));
  const season = inSeason(date);
  const seasonal = pool.filter((s) => s.seasonal);
  const rest = pool.filter((s) => !s.seasonal);
  if (season && seasonal.length) {
    const a = rotate(seasonal, Math.min(3, seasonal.length), week);
    const b = rotate(rest, 5 - a.length, week);
    return [...a, ...b];
  }
  return rotate(rest, 5, week);
}

// ---- Changing it (pure: each returns new data) ---------------------------------------------------------------------------

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Star into / out of "Every week". */
export const toggleWeekly = (d: AppData, id: string): AppData => ({ ...d, sideWork: { ...stateOf(d), weekly: toggle(stateOf(d).weekly, id) } });

/** Hide a source everywhere except the "All sources" list; starring it hides nothing, hiding it un-stars it. */
export function toggleHidden(d: AppData, id: string): AppData {
  const st = stateOf(d);
  const hidden = toggle(st.hidden, id);
  return { ...d, sideWork: { ...st, hidden, weekly: hidden.includes(id) ? st.weekly.filter((x) => x !== id) : st.weekly } };
}

/** Your own source. It is listed once, and a name that already exists is not added again. */
export function addCustomSource(d: AppData, name: string): AppData {
  const clean = name.trim().slice(0, 120);
  if (!clean) return d;
  const id = slug(clean);
  if (allSources(d).some((s) => s.id === id)) return d;
  const st = stateOf(d);
  return { ...d, sideWork: { ...st, custom: [...st.custom, { id, name: clean }] } };
}

/** Tick (or untick) a source for the week; only the last 12 weeks are kept. */
export function setTick(d: AppData, date: ISODate, id: string, on: boolean): AppData {
  const st = stateOf(d);
  const week = weekStart(date);
  const now = new Set(st.checks[week] ?? []);
  if (on) now.add(id);
  else now.delete(id);
  const checks = { ...st.checks, [week]: [...now] };
  for (const k of Object.keys(checks).sort().slice(0, -12)) delete checks[k];
  return { ...d, sideWork: { ...st, checks } };
}

/** The Google search a source opens: "<name> London jobs". */
export const searchUrl = (name: string) => `https://www.google.com/search?q=${encodeURIComponent(`"${name} London jobs"`)}`;

/** Which of the check's sources are ticked this week. */
export const ticked = (d: AppData, date: ISODate): string[] => stateOf(d).checks[weekStart(date)] ?? [];

/** Everything on this week's check: Every week + this week's 5. */
export function checklist(d: AppData, date: ISODate): Source[] {
  const seen = new Set<string>();
  return [...weeklySources(d), ...thisWeeksFive(d, date)].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** The whole check is ticked. */
export const allTicked = (d: AppData, date: ISODate) => {
  const list = checklist(d, date);
  const t = new Set(ticked(d, date));
  return list.length > 0 && list.every((s) => t.has(s.id));
};
