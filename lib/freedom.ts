import { addDays, toISO } from "./dates";
import { toHHMM, withDefaults } from "./profile";
import { planSessions } from "./schedule";
import { weekProgress } from "./sessions";
import { weekStart } from "./stats";
import type { AppData, FreedOffer, ISODate, Task } from "./types";

/**
 * Target hit = freedom. When an area's weekly target is reached (by any route: a tap, a typed tick, the timer, an early
 * tick, a backdated one) the planner already drops that area's remaining sessions for the week, so its slots,
 * reminders, check-ins and "behind" nudges disappear on their own. This file adds the two human parts, for EVERY area
 * with a weekly target (including ones added later):
 *
 *   - celebrate once ("Power BI done for the week 🎉, Sahil.")
 *   - offer the freed time once ("Thursday 18:00–19:00 is now free: Rest · Extra session · From Ideas · Another area")
 *
 * `withTargetEffects` is called by the store on every change to the session logs, so every route is covered.
 */

const celebrateKey = (week: ISODate, areaId: string) => `${week}:${areaId}`;

/** The earliest planned session of this area that is no longer needed once `after` is in place. */
export function freedSlot(before: AppData, after: AppData, areaId: string, now: Date): FreedOffer["slot"] {
  const planned = planSessions(before, now).filter((s) => s.areaId === areaId && !s.done);
  const stillThere = planSessions(after, now).filter((s) => s.areaId === areaId);
  const freed = planned.filter((s) => !stillThere.some((x) => x.date === s.date));
  const first = freed.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0];
  return first ? { date: first.date, start: first.start, end: first.end } : undefined;
}

/** Areas whose weekly target was reached by this change (reached now, not before). */
export function newlyFinished(before: AppData, after: AppData, today: ISODate): string[] {
  const was = new Set(weekProgress(before, today).filter((r) => r.finished).map((r) => r.area.id));
  return weekProgress(after, today)
    .filter((r) => r.finished && !was.has(r.area.id))
    .map((r) => r.area.id);
}

/**
 * Runs after every change to the session logs. A target reached for the first time this week is celebrated (once) and its
 * freed slot recorded; a target that is no longer reached (an undo) is forgotten so it can be celebrated again.
 */
export function withTargetEffects(before: AppData, after: AppData, now: Date = new Date()): AppData {
  if (before.sessions === after.sessions) return after;
  const today = toISO(now);
  const week = weekStart(today);
  const was = new Map(weekProgress(before, today).map((r) => [r.area.id, r.finished]));
  const celebrated = new Set(after.settings.celebrated ?? []);
  let freed = after.settings.freed;
  let touched = false;
  for (const r of weekProgress(after, today)) {
    const key = celebrateKey(week, r.area.id);
    if (r.finished && !was.get(r.area.id) && !celebrated.has(key)) {
      celebrated.add(key);
      freed = { areaId: r.area.id, week, at: now.getTime(), slot: freedSlot(before, after, r.area.id, now) };
      touched = true;
    } else if (!r.finished && was.get(r.area.id)) {
      celebrated.delete(key);
      if (freed?.areaId === r.area.id && freed.week === week) freed = undefined;
      touched = true;
    }
  }
  if (!touched) return after;
  return { ...after, settings: { ...after.settings, celebrated: [...celebrated].slice(-40), freed } };
}

/** Is this offer still worth showing? A slot in the past, or an offer from an earlier week, is not. */
export function offerIsLive(f: FreedOffer | undefined, today: ISODate, nowMin: number): f is FreedOffer {
  if (!f) return false;
  if (f.week !== weekStart(today)) return false;
  // With no time to offer, the celebration is just for the day it happened.
  if (!f.slot && toISO(new Date(f.at)) !== today) return false;
  if (f.slot && (f.slot.date < today || (f.slot.date === today && f.slot.end <= nowMin))) return false;
  return true;
}

export type FreedChoice = { kind: "rest" } | { kind: "extra" } | { kind: "idea"; ideaId: string } | { kind: "behind"; areaId: string };

/** Areas still short of their target this week, most behind first (not the one that just finished). */
export function behindAreas(data: AppData, today: ISODate, except?: string) {
  return weekProgress(data, today)
    .filter((r) => !r.finished && r.area.id !== except)
    .sort((a, b) => b.target - b.done - (a.target - a.done))
    .map((r) => r.area);
}

/** The task that fills the freed slot (a normal timed task, so the timeline places it by its usual rules). Null = Rest. */
export function taskForFreedSlot(data: AppData, offer: FreedOffer, choice: FreedChoice, now: Date): Task | null {
  if (choice.kind === "rest" || !offer.slot) return null;
  const p = withDefaults(data.profile);
  const slot = offer.slot;
  const base = {
    id: crypto.randomUUID(),
    due: slot.date,
    dueTime: toHHMM(slot.start),
    estimateMin: Math.max(10, slot.end - slot.start),
    important: false,
    tags: [] as string[],
    steps: [],
    focus: false,
    status: "open" as const,
    createdAt: now.getTime(),
  };
  const area = (id: string) => p.areas.find((a) => a.id === id);
  if (choice.kind === "extra") {
    const a = area(offer.areaId);
    return a ? { ...base, title: `${a.name} · extra session`, area: a.id, countsFor: a.id } : null;
  }
  if (choice.kind === "idea") {
    const idea = (data.bored ?? []).find((i) => i.id === choice.ideaId);
    return idea ? { ...base, title: idea.text, area: idea.areaId } : null;
  }
  const a = area(choice.areaId);
  return a?.target ? { ...base, estimateMin: Math.max(10, a.target.minutes), title: `${a.name} session`, area: a.id, countsFor: a.id } : null;
}

// ---- For the Sunday letter and capacity learning -------------------------------------------------------------------

export interface EarlyFinish {
  areaId: string;
  name: string;
  /** Weeks (of the last `weeksBack`) in which the target was reached before the last working day. */
  times: number;
  /** The usual weekday it was reached by: "Wednesday". */
  byDay?: string;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Areas that reached their weekly target early (by Thursday, so three days or more were left) in the last few weeks,
 * from the logs alone. Handles several sessions a day and backdated logs, and counts a week once.
 */
export function earlyFinishes(data: AppData, today: ISODate, weeksBack = 4): EarlyFinish[] {
  const p = withDefaults(data.profile);
  const out: EarlyFinish[] = [];
  for (const a of p.areas.filter((x) => x.target)) {
    const dows: number[] = [];
    for (let w = 0; w < weeksBack; w++) {
      const start = addDays(weekStart(today), -7 * w);
      const end = addDays(start, 6);
      const dates = (data.sessions ?? [])
        .filter((l) => l.areaId === a.id && l.date >= start && l.date <= end)
        .map((l) => l.date)
        .sort();
      const hit = dates[a.target!.perWeek - 1];
      if (hit && hit <= addDays(start, 3) && hit <= today) dows.push(new Date(`${hit}T00:00:00`).getDay());
    }
    if (dows.length) {
      const latest = Math.max(...dows.map((d) => (d + 6) % 7));
      out.push({ areaId: a.id, name: a.name, times: dows.length, byDay: WEEKDAY[(latest + 1) % 7] });
    }
  }
  return out.sort((x, y) => y.times - x.times);
}
