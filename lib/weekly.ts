import { addDays, fromISO, toISO } from "./dates";
import { eventMarkKey } from "./fixed";
import { latestByKey } from "./history";
import { toMin, withDefaults } from "./profile";
import { planWeek, SESSION_CAP } from "./schedule";
import { getOccurrences, withRepeats } from "./series";
import { otherLine, otherWeek, type OtherWeek } from "./other";
import { weeklyPercent } from "./progress";
import { weekProgress } from "./sessions";
import { weekStart } from "./stats";
import type { AppData, HistoryEvent, ISODate, Task, WeekSnapshot } from "./types";

/**
 * The weekly review, computed from your data (offline, no AI). The week is Monday to Sunday.
 *
 *   Friday 21:00  "Week so far": done / target per area, what is behind, and at most two light weekend catch-up
 *                 suggestions. NOTHING is added unless you tap "Add to Sat" / "Add to Sun".
 *   Sunday 21:00  "Your week": wins, what slipped, your own tasks ("You added 5, finished 4"), calendar events you
 *                 handled, this week vs last week per area (↑ ↓), and a focus for next week you can apply.
 *
 * The tone is honest and kind: a short week is information, never a verdict.
 */
export interface AreaRow {
  id: string;
  name: string;
  emoji: string;
  done: number;
  target: number;
  /** done / target, 0 when there is no target. Can pass 1. */
  ratio: number;
}

export interface WeekStats {
  /** Monday. */
  week: ISODate;
  areas: AreaRow[];
  /** Your own one-off tasks (what you typed, not what the app generated). */
  own: { added: number; finished: number; names: string[]; stillOpen: string[] };
  /** Repeating tasks: how many of this week's days were done so far. */
  repeats: Array<{ title: string; done: number; expected: number }>;
  /** Calendar / own events you ticked as handled. */
  events: { handled: number; names: string[] };
  missed: number;
  skipped: number;
  moved: number;
  /** Things pulled forward from later in the week (Lighten my week). */
  pulled: number;
  /** All sessions: done (capped at each target) over all targets, 0–100. */
  percent: number;
  /** "Other work" that week (minutes, target, breakdown). */
  other: OtherWeek;
}

const dayOf = (ms: number) => toISO(new Date(ms));
const inWeek = (day: ISODate, start: ISODate) => day >= start && day <= addDays(start, 6);

/** The history of one week: what was done, skipped and rescheduled that week (by when it happened), missed by its day. */
function weekEvents(data: AppData, start: ISODate): HistoryEvent[] {
  return (data.history ?? []).filter((e) => inWeek(e.kind === "missed" ? e.date : dayOf(e.at), start));
}

export function weekStats(data: AppData, week: ISODate, today: ISODate = toISO(new Date())): WeekStats {
  const start = weekStart(week);
  const end = addDays(start, 6);
  const current = today >= start && today <= end;
  const eff = withRepeats(data, today);

  // Sessions per area, counted the way the rest of the app counts them (logs, plus events that stand in for a session).
  const rows = weekProgress(data, current ? today : end);
  const areas: AreaRow[] = rows.map((r) => ({ id: r.area.id, name: r.area.name, emoji: r.area.emoji, done: r.done, target: r.target, ratio: r.target ? r.done / r.target : 0 }));
  const target = areas.reduce((n, a) => n + a.target, 0);
  const got = areas.reduce((n, a) => n + Math.min(a.done, a.target), 0);

  const events = weekEvents(data, start);
  const last = latestByKey(events);

  // Your own tasks: added this week, and finished this week (from the tasks and from the history, no double counting).
  const mine = (t: Task) => !t.generated && !t.origin;
  const added = data.tasks.filter((t) => mine(t) && inWeek(dayOf(t.createdAt), start));
  const finished = new Map<string, string>();
  for (const t of data.tasks) if (mine(t) && t.status === "done" && t.completedAt && inWeek(dayOf(t.completedAt), start)) finished.set(`task:${t.id}`, t.title);
  for (const [key, e] of last) if (key.startsWith("task:") && e.kind === "done" && e.createdByMe) finished.set(key, e.title);
  const stillOpen = added.filter((t) => t.status === "open").map((t) => t.title);

  // Repeats: how many of their days so far were done.
  const byTitle = new Map<string, { done: number; expected: number }>();
  for (const o of getOccurrences(eff, start, end, today)) {
    if (o.status === "skipped" || o.on > today) continue;
    const row = byTitle.get(o.series.title) ?? { done: 0, expected: 0 };
    row.expected++;
    if (o.status === "done") row.done++;
    byTitle.set(o.series.title, row);
  }

  // Events you ticked as handled (local marks, keyed by event and day).
  const names = new Map([...(data.events ?? []), ...(data.calendarEvents ?? [])].map((e) => [eventMarkKey(e), e.title]));
  const handled = Object.entries(data.eventMarks ?? {})
    .filter(([k, m]) => m.done && inWeek(k.slice(k.lastIndexOf("@") + 1), start))
    .map(([k]) => names.get(k) ?? "An event");

  const count = (kind: HistoryEvent["kind"]) => [...last.values()].filter((e) => e.kind === kind).length;
  return {
    week: start,
    areas,
    own: { added: added.length, finished: finished.size, names: [...finished.values()], stillOpen },
    repeats: [...byTitle.entries()].map(([title, v]) => ({ title, ...v })),
    events: { handled: handled.length, names: handled },
    missed: count("missed"),
    skipped: count("skipped"),
    moved: count("rescheduled"),
    // Each pull counts (a later tick of the same item must not hide it).
    pulled: new Set(events.filter((e) => e.kind === "pulled").map((e) => `${e.key}|${e.date}`)).size,
    // Measured in minutes, the same as the number on Today: tracked areas and Other, each capped at its own target.
    percent: weeklyPercent(data, current ? today : end).pct,
    other: otherWeek(data, start),
  };
}

// ---- Reading the numbers ---------------------------------------------------------------------------------------------------

export const wins = (s: WeekStats) => s.areas.filter((a) => a.target > 0 && a.done >= a.target);
export const slipped = (s: WeekStats) => s.areas.filter((a) => a.target > 0 && a.done < a.target);
/** Areas that are behind, the furthest behind first. */
export const behind = (s: WeekStats) => slipped(s).sort((a, b) => b.target - b.done - (a.target - a.done) || a.ratio - b.ratio);

export interface Change {
  id: string;
  name: string;
  emoji: string;
  done: number;
  was: number;
  arrow: "↑" | "↓" | "=";
}
/** This week against last week, per area. */
export function compare(cur: WeekStats, prev: WeekStats): Change[] {
  return cur.areas.map((a) => {
    const was = prev.areas.find((x) => x.id === a.id)?.done ?? 0;
    return { id: a.id, name: a.name, emoji: a.emoji, done: a.done, was, arrow: a.done > was ? "↑" : a.done < was ? "↓" : "=" };
  });
}

/** The one or two areas with the lowest done / target, below target: where next week should lean. */
export function focusFor(s: WeekStats): AreaRow[] {
  return slipped(s)
    .sort((a, b) => a.ratio - b.ratio || b.target - b.done - (a.target - a.done))
    .slice(0, 2);
}

// ---- Friday: light weekend catch-up, only if you tap ---------------------------------------------------------------------------

export interface CatchUp {
  areaId: string;
  name: string;
  emoji: string;
  date: ISODate;
  /** "Add to Sat" / "Add to Sun". */
  label: string;
  minutes: number;
}

const MAX_CATCH_UP = 2;

/**
 * At most two suggestions for the weekend, for the areas whose target the plan could NOT fully place (see `planWeek`: the
 * weekly targets are a hard rule, so what the plan could fit is already in it). Nothing is added: the suggestions are shown
 * with buttons, and only a tap adds an extra session, on a day that has no task of that area yet.
 */
export function catchUpSuggestions(data: AppData, now: Date): CatchUp[] {
  const today = toISO(now);
  const start = weekStart(today);
  const days = [addDays(start, 5), addDays(start, 6)].filter((d) => d >= today);
  if (!days.length) return [];
  const eff = withRepeats(data, today);
  const { sessions, short } = planWeek(data, now);
  const plan = sessions.filter((s) => !s.done);
  const used = new Map<ISODate, number>(days.map((d) => [d, plan.filter((s) => s.date === d).reduce((n, s) => n + s.minutes, 0) + eff.tasks.filter((t) => t.status === "open" && t.countsFor && t.due === d).reduce((n, t) => n + (t.estimateMin ?? 30), 0)]));
  const out: CatchUp[] = [];
  for (const s of [...short].sort((x, y) => y.target - y.fit - (x.target - x.fit))) {
    if (out.length >= MAX_CATCH_UP) break;
    const area = withDefaults(data.profile).areas.find((x) => x.id === s.areaId);
    if (!area?.target) continue;
    // The lightest weekend day that has no extra of this area yet (the plan's own session there stays; this is one more).
    const day = days
      .filter((d) => !eff.tasks.some((t) => t.status === "open" && t.countsFor === s.areaId && t.due === d) && !out.some((c) => c.areaId === s.areaId))
      .sort((x, y) => (used.get(x) ?? 0) - (used.get(y) ?? 0))[0];
    if (!day) continue;
    used.set(day, (used.get(day) ?? 0) + area.target.minutes);
    out.push({ areaId: s.areaId, name: s.name, emoji: area.emoji, date: day, label: `Add to ${fromISO(day).getDay() === 6 ? "Sat" : "Sun"}`, minutes: area.target.minutes });
  }
  return out;
}

/** The task "Add to Sat" creates: a session of that area on the weekend day, placed by the timeline like any other. */
export function catchUpTask(data: AppData, c: Pick<CatchUp, "areaId" | "date" | "minutes">, now: Date): Task | null {
  const area = withDefaults(data.profile).areas.find((a) => a.id === c.areaId);
  if (!area?.target) return null;
  return {
    id: crypto.randomUUID(),
    title: `${area.name} session`,
    due: c.date,
    estimateMin: c.minutes,
    area: area.id,
    countsFor: area.id,
    important: false,
    tags: [],
    steps: [],
    focus: false,
    status: "open",
    createdAt: now.getTime(),
    generated: true,
  };
}

// ---- The words ------------------------------------------------------------------------------------------------------------------

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "Job Apply (3 short), Power BI (1 short)" */
const shortList = (rows: AreaRow[]) => rows.map((a) => `${a.name} (${a.target - a.done} short)`).join(", ");

export interface Text {
  headline: string;
  lines: string[];
}

/** Friday's "Week so far". */
export function soFarText(s: WeekStats, name: string, suggestions: CatchUp[]): Text {
  const behindRows = behind(s);
  const headline = !s.areas.length
    ? `Here is your week so far, ${name}.`
    : s.percent >= 80
      ? `Strong week so far, ${name}.`
      : s.percent >= 50
        ? `A solid week so far, ${name}, with room to finish well.`
        : `A slower week so far, ${name}. That happens, and the weekend is yours either way.`;
  const lines: string[] = [];
  if (behindRows.length) lines.push(`Behind: ${shortList(behindRows)}.`);
  else if (s.areas.length) lines.push("Nothing is behind. You are right on target.");
  if (suggestions.length) lines.push(`If you would like to close the gap, a light weekend could take ${list(suggestions.map((c) => `${c.name} on ${c.label.replace("Add to ", "")}`))}. Nothing is added unless you tap.`);
  else if (behindRows.length) lines.push("The weekend stays light. Whatever is left simply rolls into next week's plan.");
  if (s.other.minutes || s.other.target) lines.push(`${otherLine(s.other)}.`);
  if (s.pulled) lines.push(pulledLine(s.pulled));
  return { headline, lines };
}

/** "You pulled 3 things forward this week 💪" */
export const pulledLine = (n: number) => `You pulled ${n} ${n === 1 ? "thing" : "things"} forward this week 💪`;

/** Sunday's "Your week". */
export function yourWeekText(s: WeekStats, prev: WeekStats, name: string): Text {
  const w = wins(s);
  const sl = slipped(s);
  const headline = !s.areas.length
    ? `Here is your week, ${name}.`
    : !sl.length
      ? `Every target met. A lovely week, ${name}.`
      : !w.length
        ? `A quieter week, ${name}. It is useful to know, and next week can be planned around it.`
        : `A good week, ${name}, with a few things that slipped.`;
  const lines: string[] = [];
  if (w.length) lines.push(`Wins: ${list(w.map((a) => a.name))}.`);
  if (sl.length) lines.push(`Slipped: ${shortList(sl.sort((a, b) => b.target - b.done - (a.target - a.done)))}.`);
  lines.push(`You added ${s.own.added}, finished ${s.own.finished}${s.own.names.length ? `: ${list(s.own.names.slice(0, 6))}${s.own.names.length > 6 ? ` and ${s.own.names.length - 6} more` : ""}` : ""}.`);
  if (s.events.handled) lines.push(`Calendar events handled: ${list(s.events.names.slice(0, 5))}.`);
  if (s.other.minutes || s.other.target) lines.push(`${otherLine(s.other)}.`);
  if (s.pulled) lines.push(pulledLine(s.pulled));
  const moves = compare(s, prev).filter((c) => c.arrow !== "=");
  if (moves.length) lines.push(`Against last week: ${moves.map((c) => `${c.name} ${c.arrow}`).join(", ")}.`);
  const focus = focusFor(s);
  lines.push(focus.length ? `Focus for next week: ${list(focus.map((a) => a.name))}.` : "No area needs extra focus next week. Keep the rhythm.");
  return { headline, lines };
}

// ---- Snapshots: each week saved, so past weeks can be read later ----------------------------------------------------------------------

export function snapshotOf(data: AppData, week: ISODate, kind: WeekSnapshot["kind"], now: Date): WeekSnapshot {
  const today = toISO(now);
  const s = weekStats(data, week, today);
  const prev = weekStats(data, addDays(s.week, -7), today);
  const name = withDefaults(data.profile).name || "friend";
  const t = kind === "week-so-far" ? soFarText(s, name, []) : yourWeekText(s, prev, name);
  return {
    week: s.week,
    at: now.getTime(),
    kind,
    areas: s.areas.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, done: a.done, target: a.target })),
    own: { added: s.own.added, finished: s.own.finished, names: s.own.names.slice(0, 40) },
    events: { handled: s.events.handled, names: s.events.names.slice(0, 40) },
    focus: kind === "your-week" ? focusFor(s).map((a) => a.id) : [],
    other: { minutes: s.other.minutes, target: s.other.target },
    text: [t.headline, ...t.lines].join("\n"),
  };
}

const MAX_BACK_WEEKS = 8;

/**
 * Snapshots that should exist by now: every finished week of the last two months that had any activity, plus this week's
 * "Week so far" from Friday evening and "Your week" from Sunday evening (at the times you set). Pure: the caller saves them.
 */
export function snapshotsDue(data: AppData, now: Date): WeekSnapshot[] {
  const today = toISO(now);
  const p = withDefaults(data.profile);
  const thisWeek = weekStart(today);
  const have = new Set((data.weeks ?? []).map((w) => `${w.week}|${w.kind}`));
  const out: WeekSnapshot[] = [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const active = (start: ISODate) => (data.sessions ?? []).some((l) => l.date >= start && l.date <= addDays(start, 6)) || weekEvents(data, start).length > 0;

  for (let i = 1; i <= MAX_BACK_WEEKS; i++) {
    const w = addDays(thisWeek, -7 * i);
    if (!have.has(`${w}|your-week`) && active(w)) out.push(snapshotOf(data, w, "your-week", now));
  }
  const dow = now.getDay();
  if (!have.has(`${thisWeek}|week-so-far`) && ((dow === 5 && nowMin >= toMin(p.fridayReviewTime)) || dow === 6 || dow === 0)) out.push(snapshotOf(data, thisWeek, "week-so-far", now));
  if (!have.has(`${thisWeek}|your-week`) && dow === 0 && nowMin >= toMin(p.reviewTime)) out.push(snapshotOf(data, thisWeek, "your-week", now));
  return out;
}
