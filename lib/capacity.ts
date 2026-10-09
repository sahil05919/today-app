import { addDays, fromISO, isISO, toISO } from "./dates";
import { toMin, withDefaults } from "./profile";
import { weekStart } from "./stats";
import type { AppData, Energy, ISODate, Slot } from "./types";

/**
 * Learns what a real day looks like for Sahil, from the last 8 weeks of history. Pure and offline.
 *
 *  - per weekday: how many flexible things he typically finishes, and what share of what he planned he finished
 *  - per area: the hour and slot where its sessions really happen
 *  - per energy: what he finishes on Low / Okay / Great days (from the morning check-in)
 *
 * "Finished" = sessions logged + tasks completed + chores and bills ticked off, on that day. Nothing is used until there
 * are at least `MIN_DAYS` days of history; before that the app says "Learning your rhythm · 6 of 10 days".
 */
export const WEEKS = 8;
export const MIN_DAYS = 10;
const MIN_SESSIONS_TO_LEARN = 4;
const SLOT_SHARE = 0.6;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface WeekdayStat {
  dow: number;
  /** Days of history on that weekday. */
  days: number;
  /** Typical number of flexible things finished. */
  typical: number | null;
  /** Share of planned things finished (0-1), when it can be told. */
  pct: number | null;
}

export interface AreaStat {
  areaId: string;
  sessions: number;
  /** The hour the session usually starts (0-23). */
  hour: number | null;
  /** The configured slot it really happens in, when one clearly stands out. */
  slotId: string | null;
  /** Minutes a session really takes, on average. */
  minutes: number | null;
}

export interface Capacity {
  /** Days in the last 8 weeks that have any record. */
  days: number;
  enough: boolean;
  weekday: WeekdayStat[];
  overall: number | null;
  byArea: Record<string, AreaStat>;
  byEnergy: Record<Energy, { days: number; typical: number | null }>;
}

const dateOfKey = (key: string): ISODate | undefined => key.split(":").find((p) => isISO(p));

/** How many flexible things were finished and skipped on each day in [from, to]. */
export function dayCounts(data: AppData, from: ISODate, to: ISODate): Map<ISODate, { finished: number; skipped: number }> {
  const out = new Map<ISODate, { finished: number; skipped: number }>();
  const bump = (d: ISODate | undefined, k: "finished" | "skipped") => {
    if (!d || d < from || d > to) return;
    const c = out.get(d) ?? { finished: 0, skipped: 0 };
    c[k]++;
    out.set(d, c);
  };
  for (const l of data.sessions ?? []) bump(l.date, "finished");
  for (const t of data.tasks) if (t.status === "done" && t.completedAt) bump(toISO(new Date(t.completedAt)), "finished");
  for (const e of data.log ?? []) {
    const kind = e.key.split(":")[0];
    if (kind !== "chore" && kind !== "bill" && kind !== "session") continue;
    // A done session is already counted from the session log.
    if (e.status === "done" && kind !== "session") bump(dateOfKey(e.key), "finished");
    else if (e.status === "skip") bump(dateOfKey(e.key), "skipped");
  }
  return out;
}

/** Which of these slots a session that started at `startMin` belongs to. */
export function slotOf(slots: Slot[], startMin: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const s of slots) {
    const a = toMin(s.start);
    const b = toMin(s.end) + 30; // the last session in a slot may run past its end
    const d = startMin >= a && startMin < b ? 0 : Math.min(Math.abs(startMin - a), Math.abs(startMin - b));
    if (d <= 60 && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best?.id ?? null;
}

/** One remembered answer, valid while the same data arrays are in use (they are replaced on every change). */
let last: { refs: unknown[]; today: ISODate; value: Capacity } | null = null;

/** Everything learned from the 8 weeks before `today` (today itself is still being lived). Memoised per data object. */
export function capacityOf(data: AppData, today: ISODate): Capacity {
  const refs = [data.tasks, data.sessions, data.log, data.checkins, data.profile];
  if (last && last.today === today && last.refs.every((r, i) => r === refs[i])) return last.value;

  const p = withDefaults(data.profile);
  const from = addDays(today, -WEEKS * 7);
  const to = addDays(today, -1);
  const counts = dayCounts(data, from, to);
  const answers = new Map((data.checkins ?? []).filter((c) => c.date >= from && c.date <= to).map((c) => [c.date, c]));

  const active = new Set<ISODate>();
  for (const [d, c] of counts) if (c.finished + c.skipped > 0) active.add(d);
  for (const d of answers.keys()) active.add(d);

  const weekday: WeekdayStat[] = Array.from({ length: 7 }, (_, dow) => {
    const ds = [...active].filter((d) => fromISO(d).getDay() === dow);
    const finished = ds.map((d) => counts.get(d)?.finished ?? 0);
    // Planned = what he kept in the morning check-in, else what he finished plus what he skipped.
    let done = 0;
    let planned = 0;
    for (const d of ds) {
      const c = counts.get(d) ?? { finished: 0, skipped: 0 };
      const a = answers.get(d);
      done += Math.min(c.finished, a ? Math.max(a.ticked, c.finished) : c.finished);
      planned += a && a.ticked > 0 ? Math.max(a.ticked, c.finished) : c.finished + c.skipped;
    }
    return { dow, days: ds.length, typical: median(finished), pct: planned > 0 ? Math.min(1, done / planned) : null };
  });

  const byArea: Record<string, AreaStat> = {};
  for (const a of p.areas.filter((x) => x.target)) {
    const logs = (data.sessions ?? []).filter((l) => l.areaId === a.id && l.date >= from && l.date <= to);
    // A backdated log says nothing about when sessions really happen (its time of day is made up).
    const timed = logs.filter((l) => !l.via);
    // The log is written when the session is ticked off, at its end, so the start is a session earlier.
    const starts = timed.map((l) => {
      const at = new Date(l.at);
      return Math.max(0, at.getHours() * 60 + at.getMinutes() - l.minutes);
    });
    const hours = starts.map((m) => Math.floor(m / 60));
    const modeHour = hours.length ? [...new Set(hours)].sort((x, y) => hours.filter((h) => h === y).length - hours.filter((h) => h === x).length || x - y)[0] : null;
    const configured = (a.target!.slots.length ? a.target!.slots : p.slots.map((s) => s.id)).map((id) => p.slots.find((s) => s.id === id)).filter((s): s is Slot => !!s);
    const slotIds = starts.map((m) => slotOf(configured, m)).filter((x): x is string => !!x);
    const counts2 = new Map<string, number>();
    for (const id of slotIds) counts2.set(id, (counts2.get(id) ?? 0) + 1);
    const top = [...counts2.entries()].sort((x, y) => y[1] - x[1])[0];
    byArea[a.id] = {
      areaId: a.id,
      sessions: logs.length,
      hour: modeHour,
      slotId: top && slotIds.length >= MIN_SESSIONS_TO_LEARN && top[1] / slotIds.length >= SLOT_SHARE ? top[0] : null,
      minutes: logs.length ? Math.round(logs.reduce((n, l) => n + l.minutes, 0) / logs.length) : null,
    };
  }

  const byEnergy = { low: [] as number[], ok: [] as number[], high: [] as number[] };
  for (const [d, a] of answers) byEnergy[a.energy].push(counts.get(d)?.finished ?? 0);

  const result: Capacity = {
    days: active.size,
    enough: active.size >= MIN_DAYS,
    weekday,
    overall: median([...active].map((d) => counts.get(d)?.finished ?? 0)),
    byArea,
    byEnergy: {
      low: { days: byEnergy.low.length, typical: median(byEnergy.low) },
      ok: { days: byEnergy.ok.length, typical: median(byEnergy.ok) },
      high: { days: byEnergy.high.length, typical: median(byEnergy.high) },
    },
  };
  last = { refs, today, value: result };
  return result;
}

// ---- Learned session slots (used by lib/schedule.ts) -------------------------------------------------------------

/**
 * Where an area's sessions really happen, so the planner can offer that slot first. Only reorders the slots he already
 * allowed for the area, never adds one, and never when he set an exact time (`at`) or locked the area's slots.
 * Judged from the weeks BEFORE this one, so the plan doesn't shuffle in the middle of a week.
 */
export function learnedSlots(data: AppData, today: ISODate): Map<string, string> {
  const out = new Map<string, string>();
  const p = withDefaults(data.profile);
  if ((data.sessions?.length ?? 0) < MIN_SESSIONS_TO_LEARN) return out;
  const cap = capacityOf(data, weekStart(today));
  for (const a of p.areas) {
    const t = a.target;
    if (!t || t.at || t.lockSlots || t.slots.length < 2) continue;
    const learned = cap.byArea[a.id]?.slotId;
    if (learned && learned !== t.slots[0] && t.slots.includes(learned)) out.set(a.id, learned);
  }
  return out;
}

/** The area's slot ids with the learned one first. */
export function orderSlots(ids: string[], learned?: string): string[] {
  return learned && ids.includes(learned) ? [learned, ...ids.filter((x) => x !== learned)] : ids;
}

export interface SlotShift {
  areaId: string;
  areaName: string;
  slotId: string;
  slotName: string;
  text: string;
}

/** Shifts the planner has made that haven't been mentioned yet, as one calm sentence each (shown once, never silently). */
export function pendingSlotShifts(data: AppData, today: ISODate): SlotShift[] {
  const p = withDefaults(data.profile);
  const seen = data.settings.slotShifts ?? {};
  const out: SlotShift[] = [];
  for (const [areaId, slotId] of learnedSlots(data, today)) {
    if (seen[areaId] === slotId) continue;
    const area = p.areas.find((a) => a.id === areaId);
    const slot = p.slots.find((s) => s.id === slotId);
    if (!area || !slot) continue;
    out.push({ areaId, areaName: area.name, slotId, slotName: slot.name, text: `${area.name} usually happens in your "${slot.name}" slot, so I'll offer it there first.` });
  }
  return out;
}
