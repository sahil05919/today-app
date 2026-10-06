import { addDays, fromISO, toISO } from "./dates";
import { kw } from "./dictionary";
import { toHHMM, toMin, withDefaults } from "./profile";
import { planSessions } from "./schedule";
import type { AppData, ISODate } from "./types";

/**
 * "No date given → pick the best sensible slot, not Later by default."
 * Works out when a vague task fits into your rhythm: emails at your email time, finance and admin after work,
 * calls to family in the evening, errands at the weekend, practice in the next planned session for that area.
 */
export interface SuggestedSlot {
  date: ISODate;
  time: string;
  /** Short, human: shown on the confirmation card ("emails time", "after work"). */
  reason: string;
}

const EMAILISH = kw(String.raw`e-?mails?|inbox|mails?|gmail|outlook`);
const MIN = 60_000;

const atTime = (date: ISODate, hhmm: string) => {
  const d = fromISO(date);
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)), 0, 0);
  return d;
};

/** The first day (from today, up to two weeks) where `timeFor(dow)` gives a time that's still ahead of now. */
function nextAt(now: Date, timeFor: (dow: number, date: ISODate) => string | null, reason: string): SuggestedSlot {
  const today = toISO(now);
  for (let i = 0; i < 15; i++) {
    const date = addDays(today, i);
    const t = timeFor(fromISO(date).getDay(), date);
    if (t && atTime(date, t).getTime() > now.getTime() + 10 * MIN) return { date, time: t, reason };
  }
  return { date: addDays(today, 1), time: "10:00", reason };
}

const weekend = (dow: number) => dow === 0 || dow === 6;

/** Maps Gemini's "best_slot" word to a real time. null for "none" or anything unknown. */
function hintSlot(hint: string, p: ReturnType<typeof withDefaults>, afterWork: string, now: Date): SuggestedSlot | null {
  const h = hint.trim().toLowerCase();
  const rhythm = p.rhythm.find((r) => r.enabled && r.id === h);
  if (rhythm) return nextAt(now, (dow) => (rhythm.days.includes(dow) ? rhythm.time : null), rhythm.label.toLowerCase());
  const slot = p.slots.find((s) => s.id === h);
  if (slot) return nextAt(now, (dow) => (slot.days.includes(dow) ? slot.start : null), slot.name.toLowerCase());
  switch (h) {
    case "emails":
      return nextAt(now, () => "20:00", "email time");
    case "before-work":
      return nextAt(now, (dow) => (p.workDays.includes(dow) ? p.slots.find((s) => s.id === "before")?.start ?? "08:00" : null), "before work");
    case "after-work":
      return nextAt(now, (dow) => (weekend(dow) ? "11:00" : afterWork), "after work");
    case "evening":
      return nextAt(now, (dow) => (weekend(dow) ? "12:00" : toHHMM(toMin(p.workEnd) + 30)), "evening");
    case "night":
      return nextAt(now, () => "20:30", "night");
    case "weekend":
      return nextAt(now, (dow) => (weekend(dow) ? "11:00" : null), "weekend");
    default:
      return null; // "work-hours", "none": let the area decide
  }
}

export function suggestSlot(areaId: string | undefined, text: string, data: AppData, now: Date = new Date(), hint?: string): SuggestedSlot {
  const p = withDefaults(data.profile);
  const afterWork = toHHMM(toMin(p.workEnd) + 15);
  const hasArea = (id: string) => p.areas.some((a) => a.id === id);

  // 1. Email: your email check-in time.
  if (EMAILISH.test(text)) {
    const chore = p.rhythm.find((r) => r.enabled && (r.id === "emails" || /e-?mail/i.test(r.label)));
    if (chore) return nextAt(now, (dow) => (chore.days.includes(dow) ? chore.time : null), "email time");
    return nextAt(now, () => "20:00", "email time");
  }

  // 2. An area with a weekly target: its next planned session.
  const area = p.areas.find((a) => a.id === areaId);
  if (area?.target) {
    const next = planSessions(data, now).find((s) => s.areaId === area.id && !s.done);
    if (next) return { date: next.date, time: toHHMM(next.start), reason: `next ${area.name} slot` };
    const slot = p.slots.find((s) => area.target!.slots.includes(s.id)) ?? p.slots[0];
    return nextAt(now, (dow) => (slot && slot.days.includes(dow) ? slot.start : null), `${area.name} time`);
  }

  // 3. Gemini's hint about where it fits ("after-work", "evening", "weekend", …).
  const hinted = hint ? hintSlot(hint, p, afterWork, now) : null;
  if (hinted) return hinted;

  switch (areaId) {
    case "work":
      // Inside work hours on the next work day.
      for (let i = 0; i < 8; i++) {
        const date = addDays(toISO(now), i);
        if (!p.workDays.includes(fromISO(date).getDay())) continue;
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const earliest = toMin(p.workStart) + 60;
        const start = i === 0 ? Math.max(earliest, Math.ceil((nowMin + 30) / 30) * 30) : earliest;
        if (start <= toMin(p.workEnd) - 30) return { date, time: toHHMM(start), reason: "work hours" };
      }
      return { date: addDays(toISO(now), 1), time: "10:00", reason: "work hours" };
    case "finance":
    case "admin":
      return nextAt(now, (dow) => (weekend(dow) ? "11:00" : afterWork), weekend(now.getDay()) ? "weekend" : "after work");
    case "family":
      return nextAt(now, (dow) => (weekend(dow) ? "12:00" : toHHMM(toMin(p.workEnd) + 30)), "evening");
    case "home":
      return nextAt(now, (dow) => (weekend(dow) ? "10:00" : toHHMM(toMin(p.workEnd) + 30)), "after work");
    case "health":
      return nextAt(now, (dow) => (weekend(dow) ? "09:30" : toHHMM(toMin(p.workEnd) + 30)), "after work");
    case "learning":
      return nextAt(now, () => "20:30", "evening study time");
    case "travel":
    case "fun":
    case "shopping":
      return nextAt(now, (dow) => (weekend(dow) ? "11:00" : null), "weekend");
    default:
      return nextAt(now, (dow) => (weekend(dow) ? "10:30" : toHHMM(toMin(p.workEnd) + 30)), hasArea("others") ? "evening" : "next free evening");
  }
}
