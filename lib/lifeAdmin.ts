import { makeSeries } from "./series";
import type { AppData, Area, ISODate, Recurrence, Series } from "./types";

/**
 * The life admin pack: recurring "Life" series, ALL ON by default and each switchable (Settings → Life admin). They are
 * flexible to-dos on their day (no fixed time, one reminder at 19:00 only if still open). A missed one rolls forward once, then
 * drops, and the history says it was missed.
 *
 * Already in Bills & chores, so not repeated here: Clean room (every 3 days), Grocery run (Sat), Finance review, Call family (Sun).
 */
export interface LifeItem {
  id: string;
  title: string;
  /** Plain English for the Settings list. */
  when: string;
  rule: Recurrence;
  minutes: number;
}

const wd = (d: number): Pick<Recurrence, "weekdays"> => ({ weekdays: [d] });

export const LIFE_ITEMS: LifeItem[] = [
  { id: "side-work", title: "Side work check", when: "Every Monday", rule: { freq: "weekly", interval: 1, ...wd(1) }, minutes: 20 },
  { id: "laundry", title: "Laundry", when: "Every Wednesday", rule: { freq: "weekly", interval: 1, ...wd(3) }, minutes: 30 },
  { id: "bedsheets", title: "Change bedsheets", when: "Every 2 weeks, Sunday", rule: { freq: "weekly", interval: 2, ...wd(0) }, minutes: 15 },
  { id: "cv", title: "Update CV / LinkedIn", when: "Every Thursday", rule: { freq: "weekly", interval: 1, ...wd(4) }, minutes: 15 },
  { id: "budget", title: "Budget review + check subscriptions", when: "Monthly, 1st Saturday", rule: { freq: "monthly", interval: 1, ...wd(6), nth: 1 }, minutes: 30 },
  { id: "haircut", title: "Haircut", when: "Every 5 weeks, Saturday", rule: { freq: "weekly", interval: 5, ...wd(6) }, minutes: 45 },
  { id: "deep-clean", title: "Clean bathroom + kitchen deep clean", when: "Monthly, last Sunday", rule: { freq: "monthly", interval: 1, ...wd(0), nth: -1 }, minutes: 60 },
  { id: "backups", title: "Check phone / laptop backups + passwords", when: "Every 3 months", rule: { freq: "monthly", interval: 3, monthDay: 1 }, minutes: 30 },
];

export const LIFE_AREA: Area = { id: "life", name: "Life", emoji: "🏡" };
export const SIDE_WORK_AREA: Area = { id: "sidework", name: "Side work", emoji: "🧳" };

const lifeSeries = (item: LifeItem, from: ISODate, now: number): Series => ({
  // A fixed id (not a random one): the same on every device, so a copy can never be mistaken for a second series.
  ...makeSeries({ id: `life-${item.id}`, title: item.title, estimateMin: item.minutes, area: "life", rule: item.rule, from, createdAt: now }),
  lifeId: item.id,
});

/** The "Life" and "Side work" areas, added next to the ones you have (before "Others"). Idempotent. */
export function withLifeAreas(d: AppData): AppData {
  const p = d.profile;
  if (!p) return d;
  const have = new Set(p.areas.map((a) => a.id));
  const add = [LIFE_AREA, SIDE_WORK_AREA].filter((a) => !have.has(a.id));
  if (!add.length) return d;
  const others = p.areas.findIndex((a) => a.id === "others");
  const areas = others < 0 ? [...p.areas, ...add] : [...p.areas.slice(0, others), ...add, ...p.areas.slice(others)];
  return { ...d, profile: { ...p, areas } };
}

/**
 * The pack: the areas, and a series for every item you do not have yet (matched by its `lifeId`), all on. Idempotent: running
 * it twice adds nothing. An item you switched off stays off; one you deleted from Repeating tasks is brought back only by
 * switching it on in Settings → Life admin (`ensureLifeSeries`).
 */
export function addLifePack(d: AppData, today: ISODate, now: number = Date.now()): AppData {
  const withAreas = withLifeAreas(d);
  const have = new Set((withAreas.series ?? []).map((s) => s.lifeId).filter(Boolean));
  const fresh = LIFE_ITEMS.filter((i) => !have.has(i.id)).map((i) => lifeSeries(i, today, now));
  return fresh.length ? { ...withAreas, series: [...(withAreas.series ?? []), ...fresh] } : withAreas;
}

/** Brings one item back (it had been deleted), on. */
export function ensureLifeSeries(d: AppData, id: string, today: ISODate): AppData {
  const item = LIFE_ITEMS.find((i) => i.id === id);
  if (!item || (d.series ?? []).some((s) => s.lifeId === id)) return d;
  return { ...withLifeAreas(d), series: [...(d.series ?? []), lifeSeries(item, today, Date.now())] };
}

/** Is this pack item on (it has a series that is not switched off)? */
export const lifeOn = (d: AppData, id: string) => (d.series ?? []).some((s) => s.lifeId === id && !s.off);
