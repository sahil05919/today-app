import { toISO } from "./dates";
import { toHHMM } from "./profile";
import { behindAreaRows } from "./pileup";
import { quoteStateOf } from "./quoteBag";
import { seriesOf } from "./series";
import { actionable, type Timeline } from "./timeline";
import { toMin } from "./profile";
import type { AppData, ISODate } from "./types";

/**
 * The words of the daily notifications that are not tied to a clock time: the morning brief, the evening check-in and the
 * time the day's quote arrives. Pure, offline.
 */

/** The three things most worth knowing about a day: booked things first, then what is due. Sessions are routine and left out. */
export function mustDos(tl: Timeline, max = 3, skip: Set<string> = new Set()): string[] {
  const items = tl.items.filter((x) => actionable(x) && !x.done && !x.skipped && ["task", "bill", "event", "calendar"].includes(x.kind) && !(x.taskId && skip.has(x.taskId)));
  const ordered = [...items.filter((x) => x.fixed), ...items.filter((x) => !x.fixed)];
  const titles = ordered.map((x) => (x.fixed && x.kind !== "task" ? `${toHHMM(x.start)} ${x.title}` : x.title));
  for (const o of tl.overflow) titles.push(o.task.title);
  return [...new Set(titles)].slice(0, max);
}

/** Is this task an occurrence of a life-admin series? */
const isLifeTask = (data: AppData, taskId: string) => !!seriesOf(data, taskId)?.lifeId;

/** "Focus: Job Apply is behind": the one area furthest behind its weekly target, or null. */
export function focusLine(data: AppData, day: ISODate): string | null {
  const row = behindAreaRows(data, day)[0];
  return row ? `Focus: ${row.name} is behind` : null;
}

/** The morning brief: one line with today's must-dos and one focus. null when there is nothing worth saying. */
export function briefFor(data: AppData, day: ISODate, tl: Timeline, name: string, off = false): { title: string; body: string } | null {
  // Life admin (laundry, haircut…) is gentle and has its own place on Today: it is not a must-do for the brief.
  const life = new Set(tl.items.filter((x) => x.taskId && isLifeTask(data, x.taskId)).map((x) => x.taskId!));
  const dos = mustDos(tl, 3, life);
  // An off day is for resting: gentle words, no focus.
  if (off) return { title: `Easy day, ${name}`, body: `Off day: ${dos.length ? dos.join(", ") : "just rest"}.` };
  const focus = focusLine(data, day);
  if (!dos.length && !focus) return null;
  const parts = [dos.length ? `Today: ${dos.join(", ")}` : "", focus ?? ""].filter(Boolean);
  return { title: `Good morning, ${name}`, body: parts.join(". ") + "." };
}

/** "Tonight: Job Prep, English Reading. Anything from email to add?" */
export function tonightBody(tl: Timeline, digest?: string | null, appDid?: string | null): string {
  const base = tonightBase(tl, digest);
  return appDid ? `${base} ${appDid}` : base;
}

function tonightBase(tl: Timeline, digest?: string | null): string {
  const left = tl.items
    .filter((x) => actionable(x) && !x.done && !x.skipped && x.kind !== "calendar" && x.kind !== "event" && x.end > 17 * 60)
    .map((x) => x.title.replace(/ · session \d+$| session \d+$/, ""));
  const names = [...new Set(left)].slice(0, 2);
  // The Gmail add-on's digest ("3 emails need you") replaces the generic nudge to share something from email.
  if (digest) return names.length ? `Tonight: ${names.join(", ")}. ${digest}.` : `A free evening. ${digest}.`;
  return names.length ? `Tonight: ${names.join(", ")}. Anything from email to add?` : "A free evening. Anything from email to add?";
}

const dayNum = (iso: ISODate) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/**
 * The minute (after midnight) a day's quote arrives: a repeatable "random" moment between `from` and `to`, on a 5-minute
 * grid, so it differs from day to day but re-planning never moves it.
 */
export function quoteMinute(data: AppData, day: ISODate, from: string, to: string): number {
  const a = toMin(from);
  const b = Math.max(a, toMin(to));
  let h = (quoteStateOf(data).seed ^ Math.imul(dayNum(day) + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  const steps = Math.floor((b - a) / 5);
  return a + (h % (steps + 1)) * 5;
}

export const isoOf = (d: Date): ISODate => toISO(d);
