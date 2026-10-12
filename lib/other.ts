import { toISO, addDays } from "./dates";
import { eventSpan, eventMarkKey } from "./fixed";
import { withDefaults } from "./profile";
import { weekStart } from "./stats";
import type { AppData, ISODate, SubLabel } from "./types";

/**
 * "Other work": everything productive you finish that does not belong to a tracked area (Power BI, Meditation, Job, English
 * Reading, Walking). Your own tasks, repeats and life admin, tasks from Gmail, bills and chores, calendar events you ticked off, and
 * time you logged by typing ("spent 2 hrs building the app"). It is counted in minutes, next to the tracked areas, and never twice:
 * a task that stands for a session, or belongs to a tracked area, is that area's.
 */
export const SUBS: SubLabel[] = ["Building", "Chores", "Admin", "Learning", "Other"];

/** Minutes assumed when an item has no estimate. */
const DEFAULT_TASK_MIN = 20;
const DEFAULT_REPEAT_MIN = 15;
const DEFAULT_BILL_MIN = 10;
const DEFAULT_CHORE_MIN = 20;
const DEFAULT_EVENT_MIN = 30;

const WORDS: Array<[SubLabel, RegExp]> = [
  ["Building", /\b(app|apps|code|coding|project|website|web ?site|build|building|develop|developing|dev|program|programming|deploy|repo|github|bug)\b/i],
  ["Chores", /\b(clean|cleaning|laundry|grocer(?:y|ies)|cook|cooking|dishes|tidy|tidying|wash|washing|iron|vacuum|sweep|safai|shopping|declutter)\b/i],
  ["Admin", /\b(bill|bills|email|emails|mail|form|forms|bank|tax|passport|insurance|paperwork|invoice|payment|pay|renew|booking|book|appointment|council|visa|document|documents)\b/i],
  ["Learning", /\b(course|courses|read|reading|study|studying|learn|learning|tutorial|lecture|book|class|practice|revise|revision)\b/i],
];

/** Which sub-label a title belongs to, guessed from its words. */
export function guessSub(text: string): SubLabel {
  for (const [sub, re] of WORDS) if (re.test(text)) return sub;
  return "Other";
}

export interface OtherEntry {
  /** Unique and stable: "task:<id>", "occ:<key>", "log:<id>", "bill:<key>", "event:<key>". Also the key of a label override. */
  key: string;
  date: ISODate;
  minutes: number;
  title: string;
  sub: SubLabel;
  source: "task" | "gmail" | "repeat" | "life" | "bill" | "chore" | "event" | "logged";
}

export interface OtherWeek {
  week: ISODate;
  entries: OtherEntry[];
  /** Everything done, in minutes (can pass the target). */
  minutes: number;
  /** The weekly target in minutes (0 = switched off). */
  target: number;
  /** What counts towards the percentage: never more than the target. */
  counted: number;
  /** Time beyond the target ("+2h extra"). */
  bonus: number;
  bySub: Array<{ sub: SubLabel; minutes: number; entries: OtherEntry[] }>;
}

const sum = (xs: Array<{ min: number }> | undefined) => (xs ?? []).reduce((n, x) => n + x.min, 0);
const dayOf = (ms: number) => toISO(new Date(ms));

/** Every Other entry whose day falls between `from` and `to` (inclusive). */
export function otherEntriesBetween(data: AppData, from: ISODate, to: ISODate): OtherEntry[] {
  const p = withDefaults(data.profile);
  const tracked = new Set(p.areas.filter((a) => a.target).map((a) => a.id));
  const inRange = (d: ISODate) => d >= from && d <= to;
  const out: OtherEntry[] = [];
  const push = (e: Omit<OtherEntry, "sub"> & { sub?: SubLabel }) => {
    if (!inRange(e.date)) return;
    out.push({ ...e, sub: data.workSubs?.[e.key] ?? e.sub ?? guessSub(e.title) });
  };

  // Your own tasks that are done. A task that stands for a session, or belongs to a tracked area, is that area's.
  for (const t of data.tasks) {
    if (t.status !== "done" || !t.completedAt) continue;
    if (t.countsFor || t.origin || t.sessionLogId || (t.area && tracked.has(t.area))) continue;
    const gmail = !!t.notes?.startsWith("From Gmail:");
    push({ key: `task:${t.id}`, date: dayOf(t.completedAt), minutes: sum(t.sessions) || t.estimateMin || DEFAULT_TASK_MIN, title: t.title, source: gmail ? "gmail" : "task" });
  }

  // Days of repeating tasks and life admin that are done.
  for (const r of data.occurrences ?? []) {
    if (r.status !== "done" || !r.doneAt) continue;
    const s = (data.series ?? []).find((x) => x.id === r.seriesId);
    if (!s || s.countsFor || (s.area && tracked.has(s.area))) continue;
    push({ key: `occ:${r.key}`, date: dayOf(r.doneAt), minutes: sum(r.sessions) || s.estimateMin || DEFAULT_REPEAT_MIN, title: r.over?.title ?? s.title, source: s.lifeId ? "life" : "repeat" });
  }

  // Bills paid and chores done (the done marks in the log).
  for (const e of data.log ?? []) {
    if (e.status !== "done") continue;
    const [kind, id] = e.key.split(":");
    const date = dayOf(e.at);
    if (kind === "bill") {
      const b = (data.bills ?? []).find((x) => x.id === id);
      if (b) push({ key: `bill:${e.key}`, date, minutes: b.kind === "chore" ? DEFAULT_CHORE_MIN : DEFAULT_BILL_MIN, title: b.name, source: b.kind === "chore" ? "chore" : "bill", sub: b.kind === "chore" ? "Chores" : "Admin" });
    } else if (kind === "chore") {
      const r = p.rhythm.find((x) => x.id === id);
      if (r) push({ key: `chore:${e.key}`, date, minutes: DEFAULT_REPEAT_MIN, title: r.label, source: "chore", sub: guessSub(r.label) === "Other" ? "Admin" : undefined });
    }
  }

  // Calendar events you ticked as done (an event that stands in for a session is that area's).
  const events = new Map([...(data.events ?? []), ...(data.calendarEvents ?? [])].map((e) => [eventMarkKey(e), e]));
  for (const [k, m] of Object.entries(data.eventMarks ?? {})) {
    if (!m.done) continue;
    const e = events.get(k);
    if (!e || (e.countsFor && tracked.has(e.countsFor))) continue;
    const [a, b] = e.start ? eventSpan(e) : [0, DEFAULT_EVENT_MIN];
    push({ key: `event:${k}`, date: e.date, minutes: Math.max(5, b - a), title: e.title, source: "event" });
  }

  // Time you logged by typing.
  for (const w of data.worklog ?? []) out.push(...(inRange(w.date) ? [{ key: `log:${w.id}`, date: w.date, minutes: w.minutes, title: w.title, sub: w.sub, source: "logged" as const }] : []));
  return out;
}

/** The weekly target for Other, in minutes (Settings, default 5 hours; 0 = off). */
export const otherTargetMin = (data: AppData) => Math.round((withDefaults(data.profile).otherHours ?? 5) * 60);

export function otherWeek(data: AppData, anyDay: ISODate): OtherWeek {
  const week = weekStart(anyDay);
  const entries = otherEntriesBetween(data, week, addDays(week, 6)).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const minutes = entries.reduce((n, e) => n + e.minutes, 0);
  const target = otherTargetMin(data);
  const counted = target ? Math.min(minutes, target) : 0;
  const bySub = SUBS.map((sub) => {
    const es = entries.filter((e) => e.sub === sub);
    return { sub, minutes: es.reduce((n, e) => n + e.minutes, 0), entries: es };
  }).filter((s) => s.entries.length);
  return { week, entries, minutes, target, counted, bonus: target ? Math.max(0, minutes - target) : 0, bySub };
}

/** 150 → "2h 30m", 120 → "2h", 45 → "45m". */
export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
}

/** "Other 6h 30m ✓" while a target is set and met, "Other 3h of 5h" before. */
export function otherLine(w: OtherWeek): string {
  if (!w.target) return `Other ${fmtMinutes(w.minutes)}`;
  return w.minutes >= w.target ? `Other ${fmtMinutes(w.minutes)} ✓${w.bonus ? ` (+${fmtMinutes(w.bonus)} extra 💪)` : ""}` : `Other ${fmtMinutes(w.minutes)} of ${fmtMinutes(w.target)}`;
}
