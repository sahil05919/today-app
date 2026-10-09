import { callGemini, aiEnabled, type AiFail, type Fetcher } from "./ai";
import { capacityOf } from "./capacity";
import { addDays, fromISO, isISO, toISO } from "./dates";
import { offDaysThisWeek } from "./offday";
import { weeklyPercent, streak } from "./progress";
import { withDefaults } from "./profile";
import { overdueTasks } from "./pileup";
import { weekProgress } from "./sessions";
import { letterFor } from "./letters";
import { weekStart } from "./stats";
import type { AppData, CoachLetter, ISODate } from "./types";

/**
 * The Sunday coach letter: one short, honest, warm letter about the week, once a week.
 * `buildWeekSummary` makes a compact summary (titles and counts only, never notes), then either Gemini writes the letter
 * from it, or, with no key / offline / any problem, a rule-based letter written from the very same summary. So a letter
 * always exists. The result is cached in the data (last 12 kept), one per week.
 */
export interface WeekSummary {
  week: ISODate;
  name: string;
  percent: number;
  areas: Array<{ name: string; done: number; target: number; minutes: number }>;
  streakDays: number;
  offDays: number;
  /** Titles of sessions / chores / bills he skipped this week. */
  skipped: string[];
  tasksDone: number;
  overdue: number;
  /** Titles of open tasks that kept getting pushed (max 3). */
  pushed: string[];
  /** Morning check-in answers this week. */
  moods: { low: number; ok: number; high: number };
  /** Learned patterns, when there's enough history. */
  patterns: { bestDay?: string; toughDay?: string; slotShifts: string[]; learning: boolean };
}

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildWeekSummary(data: AppData, today: ISODate): WeekSummary {
  const p = withDefaults(data.profile);
  const start = weekStart(today);
  const end = addDays(start, 6);
  const rows = weekProgress(data, today);

  const nameOf = (key: string): string | null => {
    const [kind, id] = key.split(":");
    if (kind === "session") return p.areas.find((a) => a.id === id)?.name ?? null;
    if (kind === "chore") return p.rhythm.find((r) => r.id === id)?.label ?? null;
    if (kind === "bill") return data.bills?.find((b) => b.id === id)?.name ?? null;
    return null;
  };
  const skipped = [
    ...new Set(
      (data.log ?? [])
        .filter((e) => e.status === "skip" && key2date(e.key) !== undefined && key2date(e.key)! >= start && key2date(e.key)! <= end)
        .map((e) => nameOf(e.key))
        .filter((x): x is string => !!x),
    ),
  ].slice(0, 6);

  const cap = capacityOf(data, today);
  let bestDay: string | undefined;
  let toughDay: string | undefined;
  if (cap.enough) {
    const ranked = cap.weekday.filter((w) => w.days >= 2 && w.typical != null).sort((a, b) => (b.typical ?? 0) - (a.typical ?? 0));
    if (ranked.length >= 3) {
      bestDay = DAY_NAME[ranked[0].dow];
      toughDay = DAY_NAME[ranked[ranked.length - 1].dow];
      if (ranked[0].typical === ranked[ranked.length - 1].typical) bestDay = toughDay = undefined;
    }
  }
  const moods = { low: 0, ok: 0, high: 0 };
  for (const c of data.checkins ?? []) if (c.date >= start && c.date <= end) moods[c.energy]++;

  return {
    week: start,
    name: p.name || "friend",
    percent: weeklyPercent(data, today).pct,
    areas: rows.map((r) => ({ name: r.area.name, done: r.done, target: r.target, minutes: r.minutes })),
    streakDays: streak(data, today).days,
    offDays: offDaysThisWeek(data, today).length,
    skipped,
    tasksDone: data.tasks.filter((t) => t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) >= start && toISO(new Date(t.completedAt)) <= end).length,
    overdue: overdueTasks(data, today).length,
    pushed: data.tasks.filter((t) => t.status === "open" && (t.snoozeCount ?? 0) >= 2).slice(0, 3).map((t) => t.title.slice(0, 60)),
    moods,
    patterns: { bestDay, toughDay, slotShifts: Object.entries(data.settings.slotShifts ?? {}).map(([a, s]) => `${p.areas.find((x) => x.id === a)?.name ?? a}: ${p.slots.find((x) => x.id === s)?.name ?? s}`), learning: !cap.enough },
  };
}

function key2date(key: string): ISODate | undefined {
  return key.split(":").find((p) => isISO(p));
}

// ---- The rule-based letter ---------------------------------------------------------------------------------------

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** Keeps whole sentences up to about `max` words. */
export function trimWords(text: string, max: number): string {
  if (words(text).length <= max) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    if (words(`${out} ${s}`).length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || words(text).slice(0, max).join(" ") + "…";
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Why an area probably fell short, in one short phrase, from what the week shows. */
function likelyReason(s: WeekSummary, area: string): string {
  if (s.skipped.includes(area)) return "you chose to skip it on a day or two";
  if (s.offDays > 0) return `the ${s.offDays === 1 ? "off day" : "off days"} took some of the room`;
  if (s.moods.low >= 2) return "a few low-energy mornings made the day smaller";
  if (s.overdue >= 3) return "pending tasks were crowding the evenings";
  return "the week simply filled up before it got its turn";
}

export function ruleLetter(s: WeekSummary): string {
  const hit = s.areas.filter((a) => a.done >= a.target);
  const short = s.areas.filter((a) => a.done < a.target).sort((a, b) => b.target - b.done - (a.target - a.done));
  const total = s.areas.reduce((n, a) => n + a.target, 0);

  // 1. What went well.
  let well: string;
  if (total && s.percent >= 80) well = `You reached ${s.percent}% of your weekly targets${hit.length ? `, with ${list(hit.slice(0, 3).map((a) => a.name))} fully done` : ""}. That's a strong week.`;
  else if (hit.length) well = `${list(hit.slice(0, 3).map((a) => a.name))} reached ${hit.length === 1 ? "its" : "their"} target, and you kept the week moving at ${s.percent}%.`;
  else if (s.streakDays >= 3) well = `You kept a ${s.streakDays}-day streak going. Showing up that often is the hard part.`;
  else if (s.tasksDone > 0) well = `You finished ${s.tasksDone} ${s.tasksDone === 1 ? "task" : "tasks"} and came back to the plan each day. That counts.`;
  else well = "You came back to the plan this week, even on days that were heavy. That counts for more than it feels like.";
  if (s.patterns.bestDay) well += ` ${s.patterns.bestDay} is where you usually get the most done.`;

  // 2. What slipped, and why.
  let slipped: string;
  if (short.length) {
    const worst = short[0];
    slipped = `${worst.name} fell short (${worst.done} of ${worst.target})${short.length > 1 ? `, and so did ${list(short.slice(1, 3).map((a) => a.name))}` : ""}. My guess: ${likelyReason(s, worst.name)}.`;
  } else if (s.overdue > 0) {
    slipped = `${s.overdue} ${s.overdue === 1 ? "thing is" : "things are"} still waiting from earlier. Nothing dramatic, it just needs a decision.`;
  } else slipped = "Nothing really slipped. Enjoy that.";

  // 3. One small, specific change.
  let change: string;
  if (short.length) {
    const worst = short[0];
    const minutes = Math.min(20, Math.max(10, Math.round((s.areas.find((a) => a.name === worst.name)?.minutes ?? 20) / Math.max(1, worst.done || 2))));
    change = `For next week, one small change: give ${worst.name} its own time on ${s.patterns.bestDay ?? "your easiest day"} and start with just ${Math.min(minutes, 20)} minutes before anything else.`;
  } else if (s.overdue > 0) change = "For next week, one small change: spend ten minutes on Monday morning deciding what each pending thing should do, instead of carrying it.";
  else change = "For next week, one small change: protect one calm hour for yourself, and keep everything else exactly as it is.";

  const out = [`Dear ${s.name},`, "", well, "", slipped, "", change, "", `Rest well, ${s.name}. A week is a draft, and you can always edit the next one.`].join("\n");
  return out;
}

// ---- The Gemini letter -------------------------------------------------------------------------------------------

/** A letter takes longer to write than a line of parsing. */
export const LETTER_TIMEOUT_MS = 25_000;
const LETTER_SCHEMA = { type: "OBJECT", properties: { letter: { type: "STRING" } }, required: ["letter"] };
const MAX_WORDS = 160;

export function letterPrompt(s: WeekSummary): { system: string; user: string } {
  return {
    system: [
      `You write a short weekly letter to ${s.name}, who uses a personal planner app. Warm, honest, plain English (a touch of Hinglish only if it feels natural).`,
      `Length: 120 to 150 words, no more. Begin with "Dear ${s.name},". Plain text, no lists, no markdown, no headings.`,
      "Cover exactly three things, in this order: what went well; what slipped and the most likely reason; one small, specific change for next week.",
      "Never guilt-trip, never shame, never use clichés or exclamation overload. Treat a missed target as information. Use only the facts in the summary and do not invent any.",
      "Return JSON: {\"letter\": \"...\"}.",
    ].join(" "),
    user: `This week's summary (counts and titles only):\n${JSON.stringify(s)}`,
  };
}

/** Checks and tidies what Gemini wrote. null = not usable (the rule-based letter is used instead). */
export function cleanLetter(raw: unknown, name: string): string | null {
  if (typeof raw !== "string") return null;
  let t = raw
    .replace(/\r/g, "")
    .replace(/[*_#`>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const n = words(t).length;
  if (n < 40 || /as an ai|language model|here is your letter/i.test(t)) return null;
  t = trimWords(t, MAX_WORDS);
  if (!/^dear\b/i.test(t)) t = `Dear ${name},\n\n${t}`;
  return t.slice(0, 1500);
}

export async function aiLetter(s: WeekSummary, opts: { fetcher?: Fetcher; key?: string; model?: string; timeoutMs?: number } = {}): Promise<{ ok: true; text: string } | AiFail> {
  const { system, user } = letterPrompt(s);
  const r = await callGemini({ system, user, schema: LETTER_SCHEMA, temperature: 0.7 }, { timeoutMs: LETTER_TIMEOUT_MS, ...opts });
  if (!r.ok) return r;
  const text = cleanLetter((r.result as unknown as { letter?: unknown }).letter, s.name);
  return text ? { ok: true, text } : { ok: false, reason: "failed", message: "The letter wasn't usable." };
}

// ---- Once a week ---------------------------------------------------------------------------------------------------

/** True when this week has no letter yet. */
export const needsLetter = (data: AppData, today: ISODate) => !letterFor(data.letters, weekStart(today));

/** Writes this week's letter: Gemini when there's a key and it works, otherwise the rule-based one. Never throws. */
export async function writeLetter(data: AppData, today: ISODate, opts: { useAi?: boolean; fetcher?: Fetcher; key?: string; model?: string; now?: number } = {}): Promise<CoachLetter> {
  const summary = buildWeekSummary(data, today);
  const at = opts.now ?? Date.now();
  if ((opts.useAi ?? aiEnabled()) && (opts.fetcher || typeof navigator === "undefined" || navigator.onLine !== false)) {
    try {
      const r = await aiLetter(summary, { fetcher: opts.fetcher, key: opts.key, model: opts.model });
      if (r.ok) return { week: summary.week, text: r.text, source: "ai", at };
    } catch {
      /* fall through to the rules */
    }
  }
  return { week: summary.week, text: trimWords(ruleLetter(summary), MAX_WORDS), source: "rules", at };
}

export const isSunday = (today: ISODate) => fromISO(today).getDay() === 0;
