import { describe, expect, it } from "vitest";
import { addDays, toISO } from "../lib/dates";
import { completeTaskIn } from "../lib/done";
import { planNotifications } from "../lib/notifications/plan";
import { carryMissed, rescheduleNow, rescheduleOptions, undoReschedule } from "../lib/reschedule";
import { planSessions, plannedForDay } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { makeSeries } from "../lib/series";
import { weekProgress } from "../lib/sessions";
import { buildTimeline } from "../lib/timeline";
import type { AppData, FixedEvent, Task } from "../lib/types";

// Wed 14 Oct 2026, 09:30 London. The week is Mon 12 … Sun 18. Yesterday (Tue 13) is in the same week.
const NOW = new Date(2026, 9, 14, 9, 30);
const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const base = (over: Partial<AppData> = {}): AppData => ({ ...withoutLife(seedIfNeeded({ version: 2, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW)), ...over });
/** These tests are not about life admin: the seeded pack is taken out so it cannot take up room in their days. */
const withoutLife = (d: AppData): AppData => ({ ...d, series: (d.series ?? []).filter((s) => !s.lifeId) });

let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `t${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const ev = (o: Partial<FixedEvent>): FixedEvent => ({ id: `e${++n}`, title: "Booked", date: TODAY, createdAt: 1, ...o });
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const target = (id: string) => ({ kind: "task" as const, taskId: id });

describe("B. the Reschedule options", () => {
  const d = base({ tasks: [task({ id: "x", title: "Call the dentist", due: TODAY, estimateMin: 20 })] });

  it("+1 hour is now + 60 minutes", () => {
    const r = rescheduleNow(d, target("x"), { kind: "hour" }, NOW)!;
    expect(r.data.tasks[0]).toMatchObject({ due: TODAY, dueTime: "10:30" });
    expect(r.message).toBe("Moved to today 10:30");
  });

  it("This evening is the first free slot from 18:00, around a booked event", () => {
    const withEvent = { ...d, events: [ev({ date: TODAY, start: "17:45", end: "19:00" })] };
    const plain = rescheduleOptions(d, target("x"), NOW)!.options.find((o) => o.kind === "evening")!;
    // 18:00 is inside the tea break, so the evening starts when it ends.
    expect(plain.dest!.time! >= "18:00").toBe(true);
    const o = rescheduleOptions(withEvent, target("x"), NOW)!.options.find((x) => x.kind === "evening")!;
    expect(o.dest!.time! >= "19:00").toBe(true);
  });

  it("This evening disappears after about 21:00", () => {
    const late = new Date(2026, 9, 14, 21, 10);
    expect(rescheduleOptions(d, target("x"), late)!.options.map((o) => o.kind)).toEqual(["hour", "tomorrow", "not-sure"]);
    expect(rescheduleOptions(d, target("x"), NOW)!.options.map((o) => o.kind)).toContain("evening");
  });

  it("Tomorrow morning is the first free slot in the 8–9 window", () => {
    const free = rescheduleOptions(d, target("x"), NOW)!.options.find((o) => o.kind === "tomorrow")!;
    expect(free.dest).toEqual({ date: addDays(TODAY, 1), time: "08:00" });
    const busy = { ...d, events: [ev({ date: addDays(TODAY, 1), start: "07:30", end: "08:30" })] };
    const o = rescheduleOptions(busy, target("x"), NOW)!.options.find((x) => x.kind === "tomorrow")!;
    // the 10-minute buffer after the event pushes the first free slot to 08:40
    expect(o.dest!.time).toBe("08:40");
  });

  it("Pick date & time sets a fixed time, and the reminder follows it", () => {
    const r = rescheduleNow(d, target("x"), { kind: "pick", date: "2026-10-16", time: "19:45" }, NOW)!;
    expect(r.data.tasks[0]).toMatchObject({ due: "2026-10-16", dueTime: "19:45" });
    const rings = planNotifications(r.data, NOW).filter((x) => x.kind === "reminder" && x.taskId === "x");
    expect(rings.map((x) => [x.at.getDate(), hhmm(x.at)])).toContainEqual([16, "19:45"]);
    // the old time rings no more
    expect(rings.some((x) => x.at.getDate() === 14)).toBe(false);
  });

  it("Undo puts everything back", () => {
    const r = rescheduleNow(d, target("x"), { kind: "hour" }, NOW)!;
    expect(undoReschedule(r.data, r.receipt).tasks[0]).toEqual(d.tasks[0]);
  });
});

describe("B. Not sure: the planner finds the next free day", () => {
  const full = (date: string): FixedEvent => ev({ date, start: "07:00", end: "23:00" });

  it("tomorrow has room: it goes tomorrow", () => {
    const d = base({ tasks: [task({ id: "x", title: "Sort the loft", due: TODAY, estimateMin: 45 })] });
    const r = rescheduleNow(d, target("x"), { kind: "not-sure" }, NOW)!;
    expect(r.dest.date).toBe(addDays(TODAY, 1));
    expect(r.data.tasks[0].dueTime).toBeUndefined();
  });

  it("tomorrow is full: it lands on the next free day", () => {
    const d = base({ tasks: [task({ id: "x", title: "Sort the loft", due: TODAY, estimateMin: 45 })], events: [full(addDays(TODAY, 1))] });
    const r = rescheduleNow(d, target("x"), { kind: "not-sure" }, NOW)!;
    expect(r.dest.date).toBe(addDays(TODAY, 2));
    expect(r.message).toMatch(/^Moved to Fri/);
    // it really fits there: the day's timeline places it
    expect(buildTimeline(r.data, addDays(TODAY, 2), new Date(2026, 9, 16)).items.some((i) => i.taskId === "x")).toBe(true);
  });

  it("a session respects weekly rules: no weekend for an area that does not allow it", () => {
    // Thursday 15 Oct is full, Fri 16 is full: Saturday and Sunday are off limits for Power BI, so Monday it is.
    const power = task({ id: "pb", title: "Power BI session 2", due: TODAY, estimateMin: 60, area: "powerbi", countsFor: "powerbi", generated: true });
    const d = base({ tasks: [power], events: [full("2026-10-15"), full("2026-10-16")] });
    const r = rescheduleNow(d, target("pb"), { kind: "not-sure" }, NOW)!;
    expect(r.dest.date).toBe("2026-10-19");
    expect(r.data.tasks[0].countsFor).toBe("powerbi");
  });
});

describe("B. missed things stay visible", () => {
  it("yesterday's missed session shows in Still to do, and Done counts it toward this week", () => {
    const d = base();
    const planned = plannedForDay(d, YESTERDAY).filter((s) => !s.done);
    expect(planned.length).toBeGreaterThan(0);
    const missed = planned[0];

    const carried = carryMissed(d, NOW);
    const t = carried.tasks.find((x) => x.origin?.key === `session:${missed.areaId}:${YESTERDAY}`)!;
    expect(t).toMatchObject({ due: YESTERDAY, countsFor: missed.areaId, generated: true });
    // it is on Today's timeline as carried over (the "Still to do" group), with the day it was meant for
    const it = buildTimeline(carried, TODAY, NOW).stillTodo.find((x) => x.taskId === t.id)!;
    expect([it.carried, it.since]).toEqual([true, YESTERDAY]);
    // and no longer on yesterday as a plain session
    expect(buildTimeline(carried, YESTERDAY, NOW).items.some((x) => x.kind === "session" && x.areaId === missed.areaId)).toBe(false);

    const before = weekProgress(carried, TODAY).find((r) => r.area.id === missed.areaId)!.done;
    const done = completeTaskIn(carried, t.id, NOW)!.data;
    expect(weekProgress(done, TODAY).find((r) => r.area.id === missed.areaId)!.done).toBe(before + 1);
  });

  it("is carried once, never double counted", () => {
    const d = base();
    const missed = plannedForDay(d, YESTERDAY).filter((s) => !s.done);
    const once = carryMissed(d, NOW);
    expect(carryMissed(once, NOW)).toBe(once);
    const left = (data: AppData, area: string) => planSessions(data, NOW).filter((s) => s.areaId === area && !s.done && s.date >= TODAY).length;
    const pending = (data: AppData, area: string) => data.tasks.filter((t) => t.status === "open" && t.countsFor === area).length;
    for (const s of missed) {
      const row = weekProgress(once, TODAY).find((r) => r.area.id === s.areaId)!;
      // Planned + carried never exceed what the week still needs (no double count), and the carried one is not lost.
      expect(left(once, s.areaId) + pending(once, s.areaId)).toBeLessThanOrEqual(row.target - row.done);
      expect(left(once, s.areaId) + pending(once, s.areaId)).toBeGreaterThanOrEqual(left(d, s.areaId));
      expect(pending(once, s.areaId)).toBe(1);
    }
  });

  it("rescheduling a carried session keeps it one session", () => {
    const d = base();
    const carried = carryMissed(d, NOW);
    const t = carried.tasks.find((x) => x.origin?.kind === "session")!;
    const r = rescheduleNow(carried, target(t.id), { kind: "pick", date: "2026-10-16", time: "19:00" }, NOW)!;
    expect(r.data.tasks.filter((x) => x.countsFor === t.countsFor)).toHaveLength(carried.tasks.filter((x) => x.countsFor === t.countsFor).length);
    expect(r.data.tasks.find((x) => x.id === t.id)).toMatchObject({ due: "2026-10-16", dueTime: "19:00", countsFor: t.countsFor });
  });

  it("a session rescheduled from the planner keeps its weekly count too", () => {
    const d = base();
    const s = plannedForDay(d, TODAY).filter((x) => !x.done)[0];
    const item = buildTimeline(d, TODAY, new Date(2026, 9, 14, 0, 0)).items.find((x) => x.kind === "session" && x.areaId === s.areaId)!;
    const left = (data: AppData) => planSessions(data, new Date(2026, 9, 14, 0, 0)).filter((x) => x.areaId === s.areaId && !x.done && x.date >= TODAY).length;
    const r = rescheduleNow(d, { kind: "item", item, date: TODAY }, { kind: "pick", date: "2026-10-16", time: "19:30" }, NOW)!;
    const moved = r.data.tasks[0];
    expect(moved).toMatchObject({ countsFor: s.areaId, due: "2026-10-16", dueTime: "19:30", origin: { kind: "session" } });
    expect(left(r.data) + 1).toBe(left(d));
    // done: counted once
    const done = completeTaskIn(r.data, moved.id, NOW)!.data;
    expect(weekProgress(done, TODAY).find((x) => x.area.id === s.areaId)!.done).toBe(1);
  });

  it("a daily item missed three days running shows once", () => {
    const vit = makeSeries({ id: "vit", title: "Vitamin", time: "11:00", rule: { freq: "daily", interval: 1 }, from: "2026-10-11", createdAt: 1 });
    const d = base({ series: [vit] });
    const now = new Date(2026, 9, 14, 9, 30);
    const items = buildTimeline(d, TODAY, now).items.filter((x) => x.title === "Vitamin");
    // yesterday's carries (once); today's own sits at 11:00
    expect(items.filter((x) => x.carried).map((x) => x.since)).toEqual([YESTERDAY]);
    expect(items).toHaveLength(2);
    expect(toISO(now)).toBe(TODAY);
  });
});
