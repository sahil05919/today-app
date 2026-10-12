import { beforeEach, describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { applyClear, previewClear } from "../lib/clear";
import { clearSuggestions, mentionsClear, parseClear } from "../lib/clearParse";
import { intentOf } from "../lib/intentPhrases";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import type { AppData, Task } from "../lib/types";

const NOW = new Date(2026, 9, 12, 12, 10); // Mon 12 Oct 2026, 12:10
const TODAY = "2026-10-12";
const t = (h: number, m = 0) => h * 60 + m;
const win = (text: string, now = NOW) => parseClear(text, now)?.windows.map((w) => [w.date, w.start, w.end]);

describe("2. the clear command: parsing (offline, never a task)", () => {
  it("clear today / clear rest of today = now to the end of the day", () => {
    expect(win("clear today")).toEqual([[TODAY, t(12, 15), t(22, 30)]]);
    expect(win("clear rest of today")).toEqual([[TODAY, t(12, 15), t(22, 30)]]);
    expect(win("Clear the rest of the day")).toEqual([[TODAY, t(12, 15), t(22, 30)]]);
  });

  it("clear till / until 7pm = now to 19:00 today", () => {
    expect(win("clear till 7pm")).toEqual([[TODAY, t(12, 15), t(19)]]);
    expect(win("clear until 7 PM")).toEqual([[TODAY, t(12, 15), t(19)]]);
    expect(win("clear until 19:30")).toEqual([[TODAY, t(12, 15), t(19, 30)]]);
  });

  it("clear until 8am tomorrow runs across midnight (two windows)", () => {
    expect(win("clear until 8am tomorrow")).toEqual([
      [TODAY, t(12, 15), t(22, 30)],
      ["2026-10-13", 0, t(8)],
    ]);
  });

  it("clear tomorrow = the whole day; clear tomorrow morning = 11:00–13:00", () => {
    expect(win("clear tomorrow")).toEqual([["2026-10-13", 0, t(22, 30)]]);
    expect(win("clear tomorrow morning")).toEqual([["2026-10-13", t(11), t(13)]]);
  });

  it("clear 13 oct 2-4pm / clear 13/10 14:00-16:00", () => {
    expect(win("clear 13 oct 2-4pm")).toEqual([["2026-10-13", t(14), t(16)]]);
    expect(win("clear 13/10 14:00-16:00")).toEqual([["2026-10-13", t(14), t(16)]]);
    expect(win("clear 13th October 10-12")).toEqual([["2026-10-13", t(10), t(12)]]);
  });

  it("clear wed evening = 17:00–22:30; clear 2 to 4 = today", () => {
    expect(win("clear wed evening")).toEqual([["2026-10-14", t(17), t(22, 30)]]);
    expect(win("clear 2 to 4")).toEqual([[TODAY, t(14), t(16)]]);
    expect(win("clear 2-4pm")).toEqual([[TODAY, t(14), t(16)]]);
  });

  it("Hinglish: aaj 7 baje tak clear, kal clear karo", () => {
    expect(win("aaj 7 baje tak clear")).toEqual([[TODAY, t(12, 15), t(19)]]);
    expect(win("kal clear karo")).toEqual([["2026-10-13", 0, t(22, 30)]]);
    expect(win("aaj clear karo")).toEqual([[TODAY, t(12, 15), t(22, 30)]]);
  });

  it("when the window cannot be parsed it is still a clear command, with what was understood to prefill the picker", () => {
    const bare = parseClear("clear", NOW)!;
    expect(bare.windows).toEqual([]);
    const half = parseClear("clear 13 oct", NOW)!; // a date alone is the whole day…
    expect(half.windows).toHaveLength(1);
    const odd = parseClear("clear 13 oct 16:00-14:00", NOW)!; // …but an impossible range is not
    expect(odd.windows).toEqual([]);
    expect(odd.understood.date).toBe("2026-10-13");
    const past = parseClear("clear until 9am", NOW)!; // 9am has passed today
    expect(past.windows).toEqual([]);
    expect(past.understood.end).toBe(t(9));
  });

  it("is an action: the intent detector sees it, and an ordinary task that starts with 'clear' stays a task", () => {
    expect(intentOf("clear until 7pm")).toBe("clear");
    expect(intentOf("kal clear karo")).toBe("clear");
    expect(intentOf("clear")).toBe("clear");
    expect(parseClear("clear the garage", NOW)).toBeNull();
    expect(parseClear("clear out garage on saturday", NOW)).toBeNull();
    expect(intentOf("buy milk")).toBeNull();
    expect(mentionsClear("clear")).toBe(true);
  });

  it("the live chips: rest of today, until (next round hour + 2 h), tomorrow, a range picker", () => {
    expect(clearSuggestions("buy milk", NOW)).toBeNull();
    const at = (h: number, m: number) => clearSuggestions("cl", new Date(2026, 9, 12, h, m)) ?? clearSuggestions("clear", new Date(2026, 9, 12, h, m))!;
    expect(at(16, 20).map((c) => c.label)).toEqual(["Clear rest of today", "Clear until 7 PM", "Clear tomorrow", "Clear a time range…"]);
    expect(at(16, 20)[1].windows).toEqual([{ date: TODAY, start: t(16, 25), end: t(19) }]);
    expect(at(12, 10).map((c) => c.label)[1]).toBe("Clear until 3 PM");
    expect(at(21, 30).map((c) => c.id)).toEqual(["rest", "tomorrow", "range"]); // 22:30 is the end of the day: no "until" chip
    expect(at(16, 20)[3].windows).toEqual([]);
  });
});

// ---- preview and apply ------------------------------------------------------------------------------------------------------
// Tuesday: Monday evening is already full of the week's sessions, so the task would only be "waiting for room".
const DAY = "2026-10-13";
const DAY_START = new Date(2026, 9, 13);
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `c${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (): AppData => ({
  ...seedIfNeeded(emptyData(), NOW),
  tasks: [
    task({ title: "Reply to Sam", due: DAY, estimateMin: 20, area: "family" }),
    task({ title: "Dentist", due: DAY, dueTime: "19:00", estimateMin: 30 }),
  ],
  calendarEvents: [{ id: "cal:7:2026-10-13", calId: "7", title: "Team social", date: DAY, start: "18:00", end: "19:00", createdAt: 1, source: "calendar" }],
});
const W = [{ date: DAY, start: t(17), end: t(21, 30) }];
const liveFlexible = (d: AppData, from: number, to: number) =>
  buildTimeline(d, DAY, DAY_START).items.filter((x) => !x.fixed && !x.muted && !x.allDay && !x.done && !x.skipped && x.start < to && x.end > from);

describe("2. the preview: nothing changes before Confirm", () => {
  it("lists the flexible items that will move (with where they go) and the fixed ones that stay by default", () => {
    const d = base();
    const before = JSON.stringify(d);
    const p = previewClear(d, W, NOW);
    expect(JSON.stringify(d)).toBe(before); // untouched
    expect(p.willMove.length).toBeGreaterThanOrEqual(2); // the evening's sessions and the task
    for (const m of p.willMove) {
      expect(["session", "task"]).toContain(m.kind);
      if (m.to) expect(m.to.date === DAY && m.to.start < t(21, 30) && m.to.start + 1 > t(17) && m.to.date === m.from.date ? "inside" : "outside").toBe("outside");
    }
    // A session that can be re-planned says where it goes; one that cannot says so (the week is full), and then the targets card reports it.
    expect(p.willMove.some((m) => m.kind === "session" && m.to && !(m.to.date === m.from.date && m.to.start === m.from.start))).toBe(true);
    expect(p.willMove.every((m) => m.to === null || m.to.date > DAY || m.to.start >= t(21, 30) || m.to.start + 1 <= t(17))).toBe(true);
    expect(p.fixed.map((f) => [f.title, f.action]).sort()).toEqual([["Dentist", "move"], ["Team social", "hide"]]);
    expect(p.fixed.find((f) => f.title === "Team social")!.note).toMatch(/Google Calendar/);
  });
});

describe("2. confirming: the block, the moves, Undo", () => {
  beforeEach(() => actions.replaceAll(base()));

  it("fixed items stay unless you choose Move; the window shows as 'Cleared' and is not refilled", () => {
    const d = base();
    const r = applyClear(d, W, new Set(), NOW, "g1");
    const tl = buildTimeline(r.data, DAY, DAY_START);
    expect(tl.items.find((x) => x.title === "Cleared")).toMatchObject({ start: t(17), end: t(21, 30), muted: true });
    expect(tl.items.find((x) => x.title === "Dentist")!.start).toBe(t(19)); // still there
    expect(tl.items.find((x) => x.title === "Team social")).toBeDefined();
    expect(liveFlexible(r.data, t(17), t(21, 30))).toEqual([]); // nothing planned into the cleared stretch
    // The planner does not refill it either, for the whole week.
    for (const s of planSessions(r.data, NOW)) if (s.date === DAY) expect(s.start >= t(21, 30) || s.end <= t(17), s.title).toBe(true);
    // A new task is not put there.
    const more = { ...r.data, tasks: [...r.data.tasks, task({ title: "Another one", due: DAY, estimateMin: 15, area: "family" })] };
    expect(liveFlexible(more, t(17), t(21, 30))).toEqual([]);
    expect(r.moved).toBeGreaterThanOrEqual(2);
  });

  it("Move reschedules a task I timed myself; Hide hides a phone-calendar event for the day", () => {
    const d = base();
    const p = previewClear(d, W, NOW);
    const dentist = p.fixed.find((f) => f.title === "Dentist")!;
    const social = p.fixed.find((f) => f.title === "Team social")!;
    const r = applyClear(d, W, new Set([dentist.key, social.key]), NOW, "g2");
    const task = r.data.tasks.find((x) => x.title === "Dentist")!;
    expect(task.due !== DAY || !(task.dueTime! >= "17:00" && task.dueTime! < "21:30")).toBe(true);
    expect(buildTimeline(r.data, DAY, DAY_START).items.some((x) => x.title === "Team social")).toBe(false);
    expect(Object.values(r.data.eventMarks ?? {}).some((m) => m.hidden)).toBe(true);
  });

  it("the store: toast text, history entry ('cleared', not skipped), and Undo restores EXACTLY, block included", () => {
    const before = getData();
    const res = actions.clearWindows(W, "until 21:30", new Set(), NOW);
    expect(res.message).toMatch(/^Cleared until 21:30 — moved \d+ items?$/);
    expect(getData().cleared).toHaveLength(1);
    const h = getData().history ?? [];
    expect(h.some((e) => e.kind === "cleared" && /Cleared until 21:30/.test(e.title))).toBe(true);
    expect(h.some((e) => e.kind === "skipped")).toBe(false);
    res.undo();
    expect(getData()).toBe(before);
    expect(getData().cleared).toBeUndefined();
  });

  it("a cleared stretch can be put back", () => {
    const res = actions.clearWindows(W, "until 21:30", new Set(), NOW);
    void res;
    const group = getData().cleared![0].group;
    actions.removeCleared(group);
    expect(getData().cleared).toEqual([]);
  });

  it("a clear that crosses midnight is two windows with one group, and undo removes both", () => {
    const before = getData();
    const two = [{ date: DAY, start: t(20), end: t(22, 30) }, { date: "2026-10-13", start: 0, end: t(8) }];
    const res = actions.clearWindows(two, "until 08:00 tomorrow", new Set(), NOW);
    const c = getData().cleared!;
    expect(c).toHaveLength(2);
    expect(c[0].group).toBe(c[1].group);
    res.undo();
    expect(getData()).toBe(before);
  });
});
