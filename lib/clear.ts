import type { ClearWindow } from "./clearParse";
import { hhmm } from "./clearParse";
import { addDays, fromISO, toISO } from "./dates";
import { withMark } from "./fixed";
import { applyMoves } from "./moves";
import { rescheduleNow } from "./reschedule";
import { settleOverflow } from "./settle";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, ClearedWindow, HistoryEvent, ISODate } from "./types";

/**
 * "Clear until 7pm": what would move, what stays, and doing it.
 *
 * The window becomes a "Cleared" busy block (data.cleared). Because the planner treats it like any busy time, flexible tasks and
 * sessions simply re-plan around it: into the next free time, respecting the weekly targets, the 11:00 rule, light weekends and what
 * you really finish in a day. What cannot stay today goes through the existing overflow reshuffle to a later day. The preview runs
 * exactly that on a copy of the data and reports where each item lands; nothing changes before Confirm.
 */
const AHEAD = 8;

export interface PreviewMove {
  key: string;
  title: string;
  emoji?: string;
  kind: TLItem["kind"];
  from: { date: ISODate; start: number };
  /** null: no room found this week (a weekly-target session then shows in the "N of M fit" card). */
  to: { date: ISODate; start: number } | null;
}

export interface PreviewFixed {
  key: string;
  title: string;
  emoji?: string;
  kind: TLItem["kind"];
  date: ISODate;
  start: number;
  end: number;
  /** What the "Move" choice does for this one. */
  action: "move" | "hide" | "none";
  /** Why it cannot be moved by the app. */
  note?: string;
}

export interface ClearPreview {
  windows: ClearWindow[];
  willMove: PreviewMove[];
  fixed: PreviewFixed[];
}

const overlaps = (it: { start: number; end: number }, w: ClearWindow) => it.start < w.end && it.end > w.start;

/** The data with the windows added as busy blocks and the day's overflow settled (a copy: nothing is saved). */
export function withCleared(data: AppData, windows: ClearWindow[], now: Date, group = "preview"): AppData {
  const at = now.getTime();
  const cleared: ClearedWindow[] = windows.map((w, i) => ({ id: `${group}-${i}`, group, date: w.date, start: w.start, end: w.end, at }));
  let next: AppData = { ...data, cleared: [...(data.cleared ?? []), ...cleared] };
  const today = toISO(now);
  for (const date of [...new Set(windows.map((w) => w.date))].sort()) {
    if (date < today) continue;
    const moves = settleOverflow(next, date === today ? now : fromISO(date));
    if (moves.length) next = applyMoves(next, moves);
  }
  return next;
}

function timelines(data: AppData, from: ISODate, now: Date) {
  const today = toISO(now);
  const out = new Map<ISODate, ReturnType<typeof buildTimeline>>();
  for (let i = 0; i <= AHEAD; i++) {
    const d = addDays(from, i);
    out.set(d, buildTimeline(data, d, d === today ? now : fromISO(d), { today }));
  }
  return out;
}

const live = (it: TLItem) => !it.muted && !it.allDay && !it.done && !it.skipped;

export function previewClear(data: AppData, windows: ClearWindow[], now: Date): ClearPreview {
  const today = toISO(now);
  const first = windows.map((w) => w.date).sort()[0] ?? today;
  const before = timelines(data, first, now);
  const trial = withCleared(data, windows, now);
  const after = timelines(trial, first, now);

  const willMove: PreviewMove[] = [];
  const fixed: PreviewFixed[] = [];
  const sessionsOf = (tls: typeof before, area: string) =>
    [...tls.entries()].flatMap(([date, tl]) => tl.items.filter((x) => x.kind === "session" && x.areaId === area && !x.done && !x.skipped).map((x) => ({ date, start: x.start })));
  const claimed = new Set<string>();

  for (const w of windows) {
    const tl = before.get(w.date);
    if (!tl) continue;
    for (const it of tl.items.filter((x) => live(x) && overlaps(x, w))) {
      const pos = { date: w.date, start: it.start };
      if (it.kind === "calendar") {
        fixed.push({ key: it.key + "@" + w.date, title: it.title, emoji: it.emoji, kind: it.kind, date: w.date, start: it.start, end: it.end, action: "hide", note: "Change it in Google Calendar if needed" });
      } else if (it.kind === "event") {
        fixed.push({ key: it.key + "@" + w.date, title: it.title, emoji: it.emoji, kind: it.kind, date: w.date, start: it.start, end: it.end, action: "none", note: "Edit the event to move it" });
      } else if (it.kind === "bill" || it.kind === "chore" || (it.kind === "task" && it.fixed)) {
        fixed.push({ key: it.key + "@" + w.date, title: it.title, emoji: it.emoji, kind: it.kind, date: w.date, start: it.start, end: it.end, action: "move" });
      } else if (it.kind === "session") {
        const were = new Set(sessionsOf(before, it.areaId!).map((s) => `${s.date}|${s.start}`));
        const arrival = sessionsOf(after, it.areaId!).find((s) => !were.has(`${s.date}|${s.start}`) && !claimed.has(`${it.areaId}|${s.date}|${s.start}`));
        if (arrival) claimed.add(`${it.areaId}|${arrival.date}|${arrival.start}`);
        willMove.push({ key: it.key + "@" + w.date, title: it.title, emoji: it.emoji, kind: it.kind, from: pos, to: arrival ?? null });
      } else if (it.kind === "task" && it.taskId) {
        let to: PreviewMove["to"] = null;
        for (const [date, atl] of after) {
          const hit = atl.items.find((x) => x.taskId === it.taskId && live(x));
          if (hit) {
            to = { date, start: hit.start };
            break;
          }
        }
        willMove.push({ key: it.key + "@" + w.date, title: it.title, emoji: it.emoji, kind: it.kind, from: pos, to });
      }
    }
  }
  return { windows, willMove, fixed };
}

/** The "Cleared" history entry (a cleared window is not a skip: the weekly review counts moved items as moved). */
export function clearedEvent(group: string, label: string, windows: ClearWindow[], at: number): HistoryEvent {
  const w = windows[0];
  return {
    id: `cleared-${group}`,
    at,
    date: w?.date ?? toISO(new Date(at)),
    kind: "cleared",
    type: "routine",
    key: `cleared:${group}`,
    title: `Cleared ${label}${w ? ` (${hhmm(w.start)}–${hhmm(w.end)})` : ""}`,
    createdByMe: true,
  };
}

export interface ClearResult {
  data: AppData;
  group: string;
  /** Items from the window that were re-planned, plus fixed ones you chose to move or hide. */
  moved: number;
}

/**
 * Does it. `choose`: the keys of fixed items you picked Move (or Hide, for a phone-calendar event) for; the others stay.
 * Pure: the store saves the result and offers Undo (the data as it was).
 */
export function applyClear(data: AppData, windows: ClearWindow[], choose: ReadonlySet<string>, now: Date, group: string): ClearResult {
  const preview = previewClear(data, windows, now);
  let next = withCleared(data, windows, now, group);
  let moved = preview.willMove.length;
  const today = toISO(now);
  for (const f of preview.fixed) {
    if (!choose.has(f.key)) continue;
    const tl = buildTimeline(data, f.date, f.date === today ? now : fromISO(f.date), { today });
    const it = tl.items.find((x) => x.key + "@" + f.date === f.key);
    if (!it) continue;
    if (f.action === "hide" && it.eventKey) {
      next = withMark(next, it.eventKey, { hidden: true });
      moved++;
    } else if (f.action === "move") {
      const target = it.taskId ? ({ kind: "task", taskId: it.taskId } as const) : ({ kind: "item", item: it, date: f.date } as const);
      const r = rescheduleNow(next, target, { kind: "not-sure" }, now);
      if (r) {
        next = r.data;
        moved++;
      }
    }
  }
  return { data: next, group, moved };
}

/** "Cleared until 19:00 — moved 4 items" */
export const clearedToast = (label: string, moved: number) => `Cleared ${label} — moved ${moved} ${moved === 1 ? "item" : "items"}`;
