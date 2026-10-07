import { inferCountsFor } from "./fixed";
import { detectIntent } from "./intents";
import { applyLearned } from "./learn";
import { kw, userWordArea } from "./dictionary";
import { parseCapture, type ParsedCapture } from "./parse";
import { withDefaults } from "./profile";
import { suggestSlot } from "./slots";
import type { AppData } from "./types";

/**
 * The offline brain, start to finish. One function turns whatever you typed or said into what the app should do:
 *
 *   text → intent (session / paid bill / shopping / note)  or  a task / reminder / chore / event with
 *          date, time and area → your learned fixes → a sensible time if none was given.
 *
 * Gemini, when it's set up (lib/ai.ts), produces the same shape and goes through the same last two steps,
 * so both brains behave the same way. Pure and synchronous: it also drives the live preview as you type.
 */

/** A commitment with a clock time: becomes a fixed block that sessions flow around. */
const EVENTISH = kw(
  String.raw`dinner|lunch|brunch|breakfast|movie|film|party|concert|gig|show|match|drinks|meeting|appointment|interview|flight|train|exam|lecture|wedding|reception|check-?up|dentist|doctor|date|visit|catch\s?up|reservation|haircut|massage|webinar|zoom|call\s+with|class`,
);
/** "book dentist 3pm" is a task about an event, not the event itself. */
const NOT_EVENT = /^\s*(?:prepare|prep|book|schedule|plan|cancel|reschedule|send|write|email|reply|buy|get|order|remind|text|message|pay|renew|pack|check|review|call\s+(?!with)|ring|follow)\b/i;

export function understand(text: string, data: AppData, now: Date = new Date()): ParsedCapture {
  const profile = withDefaults(data.profile);
  const intent = detectIntent(text, now, profile, data.bills ?? []);
  if (intent) return intent;
  return finalize(promoteEvent(parseCapture(text, now, profile)), data, now);
}

/** A task with a typed time that sounds like an appointment or a night out becomes a fixed event. */
export function promoteEvent(p: ParsedCapture): ParsedCapture {
  if (p.kind && p.kind !== "task") return p;
  if (p.timeSource !== "typed" || !p.due || !p.dueTime || p.recur) return p;
  if (!EVENTISH.test(p.title) || NOT_EVENT.test(p.title)) return p;
  return { ...p, kind: "event", event: { start: p.dueTime, end: p.dueEndTime, countsFor: undefined } };
}

/**
 * The shared last steps for both brains: your learned fixes win over guesses, then a task with no day at all
 * gets the best sensible slot instead of falling into "Later".
 */
export function finalize(p: ParsedCapture, data: AppData, now: Date): ParsedCapture {
  const profile = withDefaults(data.profile);
  let out = applyLearned(p, data.learned);
  // Words you taught the dictionary beat its own guess, but never an @area you typed or a fix you made on a card.
  if (out.areaSource !== "explicit" && out.areaSource !== "learned" && (!out.kind || out.kind === "task" || out.kind === "note")) {
    const mine = userWordArea(out.raw ?? out.title, data.userWords, new Set(profile.areas.map((a) => a.id)));
    if (mine) out = { ...out, area: mine, areaSource: "learned" };
  }
  if (out.kind === "event") {
    return { ...out, event: { ...out.event, countsFor: out.event?.countsFor ?? inferCountsFor(out.title, profile.areas) } };
  }
  if ((!out.kind || out.kind === "task") && !out.due && !out.recur && out.area !== "notes") {
    const slot = suggestSlot(out.area, out.title, data, now, out.slotHint);
    // A learned time wins over the guess; a typed time (without a date) is honoured on the suggested day.
    const time = out.dueTime && out.timeSource !== "suggested" ? out.dueTime : slot.time;
    out = { ...out, due: slot.date, dueTime: time, timeSource: out.dueTime ? out.timeSource : "suggested", slotReason: slot.reason };
  }
  return out;
}
