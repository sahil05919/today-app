import { fmtMinutes, otherLine } from "./other";
import { focusFor, slipped, weekStats, wins, type WeekStats } from "./weekly";
import type { AppData, ISODate } from "./types";

/**
 * Accountability share: a short, friendly summary of the week for a friend (WhatsApp…). It is built when you tap "Share my week" on
 * the Sunday review and handed to Android's share sheet. Nothing is sent by the app, ever, and it adds no notification.
 */
export function weekShareText(s: WeekStats, buddy?: string): string {
  const lines: string[] = [buddy?.trim() ? `Hey ${buddy.trim()}, my week:` : "My week:"];
  for (const a of s.areas) {
    if (!a.target) continue;
    lines.push(`${a.done >= a.target ? "✅" : "▫️"} ${a.emoji} ${a.name} ${a.done}/${a.target}`);
  }
  if (s.other.minutes || s.other.target) lines.push(`${s.other.target && s.other.minutes >= s.other.target ? "✅" : "▫️"} 🧩 ${otherLine(s.other)}`);
  lines.push(`Own tasks finished: ${s.own.finished}`);
  const h = highlight(s);
  if (h) lines.push(`Highlight: ${h}`);
  const focus = focusFor(s);
  lines.push(focus.length ? `Next week I'll focus on ${focus.map((a) => a.name).join(" and ")}.` : "Next week: keep the rhythm.");
  return lines.join("\n");
}

/** One thing worth saying, or null. */
export function highlight(s: WeekStats): string | null {
  const w = wins(s);
  if (s.areas.some((a) => a.target > 0) && !slipped(s).length) return "every target met 🎉";
  if (s.other.bonus >= 30) return `${fmtMinutes(s.other.bonus)} of extra work on top of my targets 💪`;
  if (w.length) return `hit the target on ${w.slice(0, 2).map((a) => a.name).join(" and ")}`;
  if (s.pulled) return `pulled ${s.pulled} ${s.pulled === 1 ? "thing" : "things"} forward`;
  if (s.own.finished >= 3) return `finished ${s.own.finished} of my own tasks`;
  return null;
}

/** The text for the week that contains `today`, with the person's own settings. */
export function shareMyWeek(data: AppData, today: ISODate, buddy?: string): string {
  return weekShareText(weekStats(data, today, today), buddy);
}
