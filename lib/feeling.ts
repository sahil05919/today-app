import { planAdjust } from "./adjust";
import { addDays, fromISO, toISO } from "./dates";
import { toHHMM } from "./profile";
import { firstDayWithRoom } from "./pileup";
import { planSessions } from "./schedule";
import { settleOverflow, type Move } from "./settle";
import { choreKey, weekProgress } from "./sessions";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, CheckInAnswer, Energy, ISODate } from "./types";

/**
 * "How are you feeling?": the morning check-in.
 *
 * Sahil chooses. Every flexible thing for today (sessions, chores, tasks) gets a tick box; booked things (events, the
 * calendar, anything with its own time, bills due today) are shown locked. A realistic set is pre-ticked from his energy
 * (and, once there is enough history, from what he usually finishes), but nothing is decided for him.
 *
 * "Make it work" keeps the ticked things in today's timeline and moves the rest to the next days with room, using the same
 * rules as everywhere else: `firstDayWithRoom` for tasks, the weekly session planner for sessions (so weekly targets and
 * the two-off-days rule still hold). Pure: `planChoice` returns what would happen, `applyChoice` does it.
 */
export interface ChoiceItem {
  key: string;
  title: string;
  emoji?: string;
  kind: TLItem["kind"];
  minutes: number;
  locked: boolean;
  /** Why it can't be unticked. */
  lockNote?: string;
  ticked: boolean;
  carried?: boolean;
  item: TLItem;
}

export interface Choice {
  energy: Energy;
  items: ChoiceItem[];
  /** One line saying why this set is ticked. */
  note: string;
}

/** What to tick when nothing has been learned yet. */
export const DEFAULT_TICKS: Record<Energy, number> = { low: 2, ok: 4, high: 6 };
const DEFAULT_NOTE: Record<Energy, string> = {
  low: "A gentle day: I've ticked the few that matter most.",
  ok: "A normal day: the most important ones are ticked.",
  high: "Good energy: I've ticked a fuller day. Untick anything you like.",
};

/** What was learned about how many he finishes, if there's enough history (see lib/capacity.ts). */
export interface TickHint {
  count: number;
  note: string;
}

const isHard = (x: TLItem, today: ISODate) => x.fixed || x.kind === "event" || x.kind === "calendar" || !!x.allDay || (x.kind === "bill" && !!x.bill && x.bill.due <= today);

/** Items of today that are still open, in timeline order, with tasks that did not even fit added at the end. */
function openItems(data: AppData, now: Date): TLItem[] {
  const today = toISO(now);
  const tl = buildTimeline(data, today, now);
  const items = tl.items.filter((x) => !x.muted && !x.done && !x.skipped);
  for (const o of tl.overflow) {
    items.push({ key: `task:${o.task.id}`, kind: "task", title: o.task.title, start: 0, end: Math.max(10, o.task.estimateMin ?? 20), fixed: false, done: false, skipped: false, taskId: o.task.id, areaId: o.task.area, carried: o.carried || undefined });
  }
  return items;
}

export function buildChoice(data: AppData, now: Date, energy: Energy, hint?: TickHint | null): Choice {
  const today = toISO(now);
  const items = openItems(data, now);
  // Priority order for the pre-ticks: the same ranking "Adjust my day" uses (overdue and important first, sessions, chores).
  const ranked = planAdjust(data, now, { minutes: 100_000, energy }).keep.map((x) => x.key);
  const rank = (k: string) => {
    const i = ranked.indexOf(k);
    return i < 0 ? 9999 : i;
  };
  const flexible = items.filter((x) => !isHard(x, today));
  const want = Math.min(flexible.length, hint?.count ?? DEFAULT_TICKS[energy]);
  const tickSet = new Set([...flexible].sort((a, b) => rank(a.key) - rank(b.key)).slice(0, want).map((x) => x.key));

  const out: ChoiceItem[] = items.map((x) => {
    const locked = isHard(x, today);
    return {
      key: x.key,
      title: x.title.replace(/ · session \d+$/, ""),
      emoji: x.emoji,
      kind: x.kind,
      minutes: Math.max(5, x.end - x.start),
      locked,
      lockNote: locked ? (x.kind === "bill" ? "due today" : x.kind === "event" || x.kind === "calendar" ? "booked" : x.fixed ? "has its own time" : "booked") : undefined,
      ticked: locked || tickSet.has(x.key),
      carried: x.carried,
      item: x,
    };
  });
  // Booked things first (they're the frame of the day), then the flexible ones best-first.
  out.sort((a, b) => Number(b.locked) - Number(a.locked) || (a.locked ? a.item.start - b.item.start : rank(a.key) - rank(b.key)));
  return { energy, items: out, note: hint?.note ?? (flexible.length ? DEFAULT_NOTE[energy] : "Nothing flexible today. Just the booked things.") };
}

const dayLabel = (to: ISODate, today: ISODate) => (to === addDays(today, 1) ? "tomorrow" : fromISO(to).toLocaleDateString("en-GB", { weekday: "long" }));
const shortTitle = (s: string) => s.replace(/ · session \d+$| session \d+$/, "");

/** The log key that "skip for today" uses for a session, chore or bill. */
export function skipKeyOf(it: TLItem, date: ISODate): string | null {
  if (it.kind === "session") return it.sessionKey ?? null;
  if (it.kind === "chore" && it.choreId) return choreKey(it.choreId, date);
  if (it.kind === "bill" && it.bill) return it.bill.key;
  return null;
}

export interface ChoicePlan {
  /** Unticked tasks: the next day with room. */
  taskMoves: Move[];
  /** Unticked sessions, chores and bills: skipped for today (sessions re-plan across the week). */
  skips: Array<{ key: string; title: string }>;
  /** Ticked tasks that still don't fit the evening, moved the usual way. */
  settle: Move[];
  /** "Power BI → Sunday 18:30" for each thing moved. */
  lines: string[];
  /** Weekly targets that can't be met after the change. */
  warnings: string[];
  /** One sentence: "Moved Power BI to Sunday 18:30, English Reading to tomorrow." */
  summary: string;
  keptCount: number;
  movedCount: number;
}

/** The data as it would be after the plan (log skips + moved tasks). Used to judge the result and by tests. */
export function applyChoiceToData(data: AppData, plan: Pick<ChoicePlan, "taskMoves" | "skips" | "settle">, now: number = Date.now()): AppData {
  const by = new Map([...plan.taskMoves, ...plan.settle].map((m) => [m.taskId, m]));
  return {
    ...data,
    log: [...(data.log ?? []).filter((e) => !plan.skips.some((s) => s.key === e.key)), ...plan.skips.map((s) => ({ key: s.key, status: "skip" as const, at: now }))],
    tasks: data.tasks.map((t) => {
      const m = by.get(t.id);
      return m ? { ...t, due: m.to, dueTime: undefined, remindAt: undefined, slot: undefined, hideUntil: undefined } : t;
    }),
  };
}

/** Works out what "Make it work" does for these ticks, without changing anything. */
export function planChoice(data: AppData, now: Date, ticked: ReadonlySet<string>): ChoicePlan {
  const today = toISO(now);
  const tomorrow = addDays(today, 1);
  const open = openItems(data, now).filter((x) => !isHard(x, today));
  const dropped = open.filter((x) => !ticked.has(x.key));

  // 1. Sessions, chores and bills that were unticked are skipped for today; the week's planner spreads sessions over other days.
  const skips: ChoicePlan["skips"] = [];
  for (const it of dropped) {
    if (it.kind === "task") continue;
    const key = skipKeyOf(it, today);
    if (key) skips.push({ key, title: shortTitle(it.title) });
  }
  let work = applyChoiceToData(data, { taskMoves: [], skips, settle: [] }, now.getTime());

  // 2. Unticked tasks go, one at a time, to the first day whose real timeline has room (later ones see the earlier moves).
  const taskMoves: Move[] = [];
  for (const it of dropped) {
    if (it.kind !== "task" || !it.taskId) continue;
    const t = work.tasks.find((x) => x.id === it.taskId);
    if (!t) continue;
    const to = firstDayWithRoom(work, t, tomorrow);
    taskMoves.push({ taskId: t.id, title: t.title, from: t.due ?? today, to });
    work = applyChoiceToData(work, { taskMoves: [{ taskId: t.id, title: t.title, from: t.due ?? today, to }], skips: [], settle: [] }, now.getTime());
  }

  // 3. If what he kept still can't fit this evening, those tasks move the usual way, and we say so.
  const settle = settleOverflow(work, now);
  if (settle.length) work = applyChoiceToData(work, { taskMoves: [], skips: [], settle }, now.getTime());

  // 4. Where did the sessions land? Say it, and say plainly when a weekly target can't be met any more.
  const plan = planSessions(work, now);
  const lines: string[] = [];
  const warnings: string[] = [];
  for (const it of dropped.filter((x) => x.kind === "session")) {
    const next = plan.find((s) => s.areaId === it.areaId && !s.done && s.date > today);
    lines.push(next ? `${shortTitle(it.title)} → ${dayLabel(next.date, today)} ${toHHMM(next.start)}` : `${shortTitle(it.title)} → not this week`);
  }
  for (const m of [...taskMoves, ...settle]) lines.push(`${m.title} → ${dayLabel(m.to, today)}`);
  const skippedOther = dropped.filter((x) => x.kind === "chore" || x.kind === "bill");
  for (const it of skippedOther) lines.push(`${shortTitle(it.title)} → skipped today`);

  const touched = new Set(dropped.filter((x) => x.kind === "session").map((x) => x.areaId));
  for (const r of weekProgress(work, today)) {
    if (!touched.has(r.area.id)) continue;
    const planned = plan.filter((s) => s.areaId === r.area.id && !s.done).length;
    if (r.done + planned < r.target) warnings.push(`${r.area.name}: ${r.target - r.done - planned} short of this week's target. A session can still be added later.`);
  }

  const moveLines = lines.filter((l) => !l.endsWith("skipped today"));
  const shown = moveLines.slice(0, 3).map((l) => l.replace(" → ", " to "));
  const more = moveLines.length > 3 ? ` and ${moveLines.length - 3} more` : "";
  const summary = moveLines.length
    ? `Moved ${shown.join(", ")}${more}.`
    : skippedOther.length
      ? `Skipped ${skippedOther.map((x) => shortTitle(x.title)).slice(0, 2).join(" and ")} for today.`
      : "You're keeping everything. Today is yours.";
  return { taskMoves, skips, settle, lines, warnings, summary, keptCount: open.length - dropped.length, movedCount: dropped.length + settle.length };
}

/** Applies the plan through the store's own actions (the same ones "Adjust my day" uses). */
export function applyChoice(plan: ChoicePlan, api: { moveTasks: (m: Array<{ taskId: string; to: ISODate }>) => void; setEntry: (key: string, status: "skip") => void }) {
  const moves = [...plan.taskMoves, ...plan.settle].map((m) => ({ taskId: m.taskId, to: m.to }));
  if (moves.length) api.moveTasks(moves);
  for (const s of plan.skips) api.setEntry(s.key, "skip");
}

/** Today's answer, if the check-in has been done. */
export const answerFor = (data: AppData, date: ISODate): CheckInAnswer | undefined => data.checkins?.find((c) => c.date === date);
