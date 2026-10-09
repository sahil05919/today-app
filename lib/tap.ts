import { addDays, isISO } from "./dates";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, FixedEvent, ISODate } from "./types";

/** What a notification carries in its `extra` (see lib/notifications/native.ts). */
export interface TapInfo {
  kind: string;
  taskId?: string;
  /** The notification's own key, e.g. "event:<id>", "session:powerbi:2026-10-07". */
  key?: string;
  /** What Done / Snooze / Skip refer to: "session:<area>:<date>", "chore:<id>:<date>", "bill:<id>:<due>". */
  ref?: string;
}

/** Where a tap should land. `gone` = the thing is already done, skipped or deleted. */
export type TapResolution =
  | { k: "task"; taskId: string }
  | { k: "checkin"; taskId: string }
  | { k: "item"; it: TLItem; date: ISODate }
  | { k: "event"; e: FixedEvent }
  | { k: "panel"; panel: "review" | "evening" | "feeling" | "quote" | "progress" }
  | { k: "gone"; message: string }
  | { k: "none" };

const GONE = "Already done 👍";
/** How many days ahead a tap may reach for its item (a bill reminder fires up to a few days before it's due). */
const SCAN_DAYS = 8;

/** The date at the end of a key like "session:powerbi:2026-10-07" or "bill:rent:2026-11-01:3". */
export function dateInKey(key: string | undefined): ISODate | undefined {
  return key?.split(":").find((p) => isISO(p));
}

/** Finds the timeline item a session / chore / bill notification was about. Searches its own day first, then the week. */
export function findTimelineItem(data: AppData, ref: string, today: ISODate, now: Date): { it: TLItem; date: ISODate } | null {
  const [kind, id] = ref.split(":");
  const match = (it: TLItem) => {
    if (kind === "session") return it.kind === "session" && it.sessionKey === ref;
    if (kind === "chore") return it.kind === "chore" && it.choreId === id;
    if (kind === "bill") return it.kind === "bill" && it.bill?.key === ref;
    return false;
  };
  const days = [dateInKey(ref), ...Array.from({ length: SCAN_DAYS }, (_, i) => addDays(today, i))].filter((d): d is ISODate => !!d);
  for (const day of [...new Set(days)]) {
    const it = buildTimeline(data, day, day === today ? now : new Date(`${day}T00:00:00`)).items.find(match);
    if (it) return { it, date: day };
  }
  return null;
}

export const findEvent = (data: AppData, id: string): FixedEvent | undefined => [...(data.events ?? []), ...(data.calendarEvents ?? [])].find((e) => e.id === id);

/** Turns a tapped notification into the card it should open. Pure, so the lookup is testable. */
export function resolveTap(data: AppData, t: TapInfo, today: ISODate, now: Date = new Date()): TapResolution {
  if (t.kind === "wrap") return { k: "panel", panel: "evening" };
  if (t.kind === "review") return { k: "panel", panel: "review" };
  if (t.kind === "morning") return { k: "panel", panel: "feeling" };
  if (t.kind === "quote") return { k: "panel", panel: "quote" };
  if (t.kind === "nudge") return { k: "panel", panel: "progress" };

  if (t.kind === "event") {
    const id = t.key?.startsWith("event:") ? t.key.slice(6) : undefined;
    const e = id ? findEvent(data, id) : undefined;
    return e ? { k: "event", e } : { k: "gone", message: "That event is gone" };
  }

  if (t.kind === "session" || t.kind === "chore" || t.kind === "bill") {
    const ref = t.ref ?? t.key;
    if (!ref) return { k: "none" };
    const found = findTimelineItem(data, ref, today, now);
    if (!found || found.it.done || found.it.skipped) return { k: "gone", message: GONE };
    return { k: "item", it: found.it, date: found.date };
  }

  if (t.taskId) {
    const task = data.tasks.find((x) => x.id === t.taskId);
    if (!task || task.status !== "open") return { k: "gone", message: GONE };
    return t.kind === "checkin" ? { k: "checkin", taskId: task.id } : { k: "task", taskId: task.id };
  }
  return { k: "none" };
}
