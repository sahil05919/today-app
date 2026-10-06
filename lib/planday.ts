import { toISO } from "./dates";
import { nextStep, remainingMinutes } from "./estimate";
import { priorityScore } from "./rescue";
import { toHHMM, toMin, withDefaults } from "./profile";
import { buildDurationModel } from "./stats";
import type { AppData, ISODate, Profile, Task } from "./types";

/**
 * "Plan my day": a simple timeline for today.
 * Fixed blocks (work, lunch, commute, gym, anything with a set time) go in first.
 * What's left is free gaps, and tasks are slotted into them by priority, due date and estimate.
 * Everything is in minutes after midnight.
 */
export type BlockKind = "work" | "lunch" | "commute" | "gym" | "event" | "task";

export interface Block {
  id: string;
  kind: BlockKind;
  label: string;
  start: number;
  end: number;
  /** Fixed blocks can't be dragged. */
  fixed: boolean;
  taskId?: string;
  /** For task blocks: why it got this time (shown in small print). */
  note?: string;
}

export interface DayPlan {
  date: ISODate;
  blocks: Block[];
  unplaced: Task[];
  /** The visible window of the day. */
  dayStart: number;
  dayEnd: number;
}

interface Gap {
  start: number;
  end: number;
  /** Inside work hours: only for Work-area tasks. */
  work: boolean;
}

const BUFFER = 5; // breathing room after each task
const MIN_GAP = 10;
const MAX_BLOCK = 90; // longer tasks get their next step slotted instead
const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

const FOCUS_WINDOW = { morning: [0, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [17 * 60, 24 * 60] } as const;

function subtract(gaps: Gap[], s: number, e: number): Gap[] {
  const out: Gap[] = [];
  for (const g of gaps) {
    if (e <= g.start || s >= g.end) out.push(g);
    else {
      if (s > g.start) out.push({ ...g, end: s });
      if (e < g.end) out.push({ ...g, start: e });
    }
  }
  return out;
}

export function buildDayPlan(data: AppData, now: Date = new Date()): DayPlan {
  const p: Profile = withDefaults(data.profile);
  const date = toISO(now);
  const dow = now.getDay();
  const model = buildDurationModel(data.tasks);

  const qs = toMin(p.quietStart);
  const qe = toMin(p.quietEnd);
  const wake = qs > qe ? qe : 7 * 60;
  const dayEnd = qs > qe ? qs : 22 * 60;
  const dayStart = Math.min(dayEnd, Math.max(wake, ceilTo(now.getHours() * 60 + now.getMinutes() + 5, 15)));

  const blocks: Block[] = [];
  const isWorkDay = p.workDays.includes(dow);
  const ws = toMin(p.workStart);
  const we = toMin(p.workEnd);
  const busy: Array<[number, number]> = [];

  if (isWorkDay) {
    if (p.commuteToMin > 0) blocks.push({ id: "commute-to", kind: "commute", label: "Commute", start: ws - p.commuteToMin, end: ws, fixed: true });
    blocks.push({ id: "work", kind: "work", label: "Work", start: ws, end: we, fixed: true });
    if (p.lunchMin > 0) blocks.push({ id: "lunch", kind: "lunch", label: "Lunch", start: toMin(p.lunchStart), end: toMin(p.lunchStart) + p.lunchMin, fixed: true });
    if (p.commuteFromMin > 0) blocks.push({ id: "commute-from", kind: "commute", label: "Commute home", start: we, end: we + p.commuteFromMin, fixed: true });
    busy.push([ws - p.commuteToMin, we + p.commuteFromMin]);
  }
  if (p.gymDays.includes(dow) && p.gymMin > 0) {
    const gs = toMin(p.gymStart);
    blocks.push({ id: "gym", kind: "gym", label: "Gym", start: gs, end: gs + p.gymMin, fixed: true });
    busy.push([gs, gs + p.gymMin]);
  }

  const open = data.tasks.filter((t) => t.status === "open");

  // Things with a set time today are fixed.
  const timed = open.filter((t) => t.due === date && t.dueTime);
  for (const t of timed) {
    const s = toMin(t.dueTime!);
    const dur = Math.max(10, ceilTo(t.estimateMin ?? 30, 5));
    blocks.push({ id: `event-${t.id}`, kind: "event", label: t.title, start: s, end: s + dur, fixed: true, taskId: t.id });
    busy.push([s, s + dur]);
  }

  // Free gaps: the day minus everything fixed; work hours are tracked separately for Work tasks.
  let gaps: Gap[] = [{ start: dayStart, end: dayEnd, work: false }];
  for (const [s, e] of busy) gaps = subtract(gaps, s, e);
  if (isWorkDay) {
    let workGaps: Gap[] = [{ start: Math.max(ws, dayStart), end: Math.min(we, dayEnd), work: true }];
    if (p.lunchMin > 0) workGaps = subtract(workGaps, toMin(p.lunchStart), toMin(p.lunchStart) + p.lunchMin);
    for (const t of timed) {
      const s = toMin(t.dueTime!);
      workGaps = subtract(workGaps, s, s + Math.max(10, ceilTo(t.estimateMin ?? 30, 5)));
    }
    gaps = [...gaps, ...workGaps.filter((g) => g.end > g.start)];
  }
  gaps = gaps.filter((g) => g.end - g.start >= MIN_GAP);

  const timedIds = new Set(timed.map((t) => t.id));
  const candidates = open
    .filter((t) => !timedIds.has(t.id))
    .filter((t) => (t.due != null && t.due <= date) || t.focus || (t.important && !t.due))
    .sort((a, b) => priorityScore(b, date) - priorityScore(a, date) || a.createdAt - b.createdAt);

  const [fs, fe] = FOCUS_WINDOW[p.bestFocus];
  const isWorkTask = (t: Task) => !!t.area && !!p.areas.find((a) => a.id === t.area)?.isWork;
  const unplaced: Task[] = [];

  for (const t of candidates) {
    const rem = Math.max(5, ceilTo(remainingMinutes(t, model).minutes, 5));
    let minutes = rem;
    let note: string | undefined;
    const step = nextStep(t);
    if (rem > MAX_BLOCK) {
      minutes = Math.min(MAX_BLOCK, ceilTo(step?.estimateMin ?? 60, 5));
      note = step ? `Next step: ${step.title}` : "A first chunk";
    }
    const deep = minutes >= 40 || t.important;
    const work = isWorkTask(t);

    type Option = { gapIndex: number; start: number; inFocus: boolean; slack: number };
    const options: Option[] = [];
    gaps.forEach((g, gapIndex) => {
      if (g.work && !work) return;
      if (g.end - g.start < minutes) return;
      // Earliest start inside the focus window if there is room, else the gap's own start.
      const inWindowStart = Math.max(g.start, fs);
      if (inWindowStart + minutes <= Math.min(g.end, fe)) {
        options.push({ gapIndex, start: inWindowStart, inFocus: true, slack: g.end - g.start - minutes });
      }
      if (g.start + minutes <= g.end && (g.start < fs || g.start >= fe || inWindowStart !== g.start)) {
        options.push({ gapIndex, start: g.start, inFocus: g.start >= fs && g.start + minutes <= fe, slack: g.end - g.start - minutes });
      }
    });
    if (!options.length) {
      unplaced.push(t);
      continue;
    }
    options.sort((a, b) => {
      // Work tasks like work gaps; deep tasks like the focus window; quick ones keep clear of it.
      const aw = gaps[a.gapIndex].work ? 0 : 1;
      const bw = gaps[b.gapIndex].work ? 0 : 1;
      if (work && aw !== bw) return aw - bw;
      const af = deep ? (a.inFocus ? 0 : 1) : a.inFocus ? 1 : 0;
      const bf = deep ? (b.inFocus ? 0 : 1) : b.inFocus ? 1 : 0;
      if (af !== bf) return af - bf;
      return deep ? a.start - b.start : a.slack - b.slack || a.start - b.start;
    });
    const o = options[0];
    blocks.push({
      id: `task-${t.id}`,
      kind: "task",
      label: t.title,
      start: o.start,
      end: o.start + minutes,
      fixed: false,
      taskId: t.id,
      note: note ?? (deep && o.inFocus ? "Your best focus time" : undefined),
    });
    gaps = subtract(gaps, o.start, o.start + minutes + BUFFER).filter((g) => g.end - g.start >= MIN_GAP);
  }

  blocks.sort((a, b) => a.start - b.start || b.end - a.end);
  return { date, blocks, unplaced, dayStart, dayEnd };
}

/** The times to save onto the tasks when the plan is accepted. */
export function slotsFromPlan(plan: DayPlan): Array<{ taskId: string; start: string; min: number }> {
  return plan.blocks
    .filter((b) => b.kind === "task" && b.taskId)
    .map((b) => ({ taskId: b.taskId!, start: toHHMM(b.start), min: b.end - b.start }));
}
