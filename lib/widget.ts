import { skipKeyOf } from "./feeling";
import { weeklyPercent } from "./progress";
import { paceStatus } from "./pace";
import { toHHMM, withDefaults } from "./profile";
import { addDays, fromISO, toISO } from "./dates";
import { actionable, buildTimeline, type TLItem } from "./timeline";
import type { AppData, ISODate } from "./types";

/**
 * What the Android home-screen widget shows, computed here so Java has no planning logic of its own.
 * The app saves this small snapshot into SharedPreferences (through the TodayNative plugin) whenever the data changes,
 * on resume and when the day rolls over. The widget picks "Next up" from the item list by the clock (the same rule as
 * `nextUp`), so it stays right between app launches.
 */
export interface WidgetItem {
  key: string;
  title: string;
  emoji?: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
  kind: TLItem["kind"];
  /** Start / Done make sense (a task, session, chore or bill). Events only open the app. */
  act: boolean;
  /** Entry key for session / chore / bill ("session:powerbi:2026-10-07"). */
  ref?: string;
  taskId?: string;
  carried?: boolean;
}

export interface WidgetSnapshot {
  v: 1;
  /** The day this list is for. The widget shows a "new day" prompt if the phone's date has moved on. */
  date: ISODate;
  name: string;
  items: WidgetItem[];
  pct: number;
  pace: string;
  /** First thing tomorrow, for when today is done. */
  tomorrow?: { title: string; time: string };
}

const MAX_ITEMS = 24;

export function buildWidgetSnapshot(data: AppData, now: Date = new Date()): WidgetSnapshot {
  const today = toISO(now);
  const p = withDefaults(data.profile);
  const tl = buildTimeline(data, today, now);
  const items: WidgetItem[] = tl.items
    .filter((x) => actionable(x) && !x.done && !x.skipped)
    .slice(0, MAX_ITEMS)
    .map((x) => {
      const act = x.kind === "task" || x.kind === "session" || x.kind === "chore" || x.kind === "bill";
      return {
        key: x.key,
        title: x.title.slice(0, 80),
        emoji: x.emoji,
        start: x.start,
        end: x.end,
        kind: x.kind,
        act,
        ref: act && x.kind !== "task" ? (skipKeyOf(x, today) ?? undefined) : undefined,
        taskId: x.taskId,
        carried: x.carried || undefined,
      };
    });
  const pct = weeklyPercent(data, today);
  const hasTargets = pct.target > 0;

  // First open thing tomorrow, from its own morning.
  const next = addDays(today, 1);
  const first = buildTimeline(data, next, fromISO(next)).items.find((x) => actionable(x) && !x.done && !x.skipped);
  return {
    v: 1,
    date: today,
    name: p.name || "friend",
    items,
    pct: hasTargets ? pct.pct : -1,
    pace: hasTargets ? paceStatus(data, today).label : "",
    tomorrow: first ? { title: first.title.slice(0, 80), time: toHHMM(first.start) } : undefined,
  };
}

/** Changes whenever what the widget would show changes (so we only talk to Android when we must). */
export const snapshotSignature = (s: WidgetSnapshot) => JSON.stringify(s);

/** A Done tapped on the widget, waiting for the app to apply it. */
export interface WidgetAction {
  type: "done";
  kind: WidgetItem["kind"];
  key: string;
  ref?: string;
  taskId?: string;
  date: ISODate;
  at: number;
}
