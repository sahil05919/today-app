import { describe, expect, it } from "vitest";
import { balanceNudge } from "../lib/balance";
import { buildDayPlan, slotsFromPlan } from "../lib/planday";
import { defaultProfile, toHHMM } from "../lib/profile";
import type { AppData, Profile, Task } from "../lib/types";

const task = (over: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2),
  title: "Task",
  important: false,
  tags: [],
  steps: [],
  focus: false,
  status: "open",
  createdAt: 1,
  ...over,
});
const data = (tasks: Task[], profile: Partial<Profile> = {}): AppData => ({
  version: 1,
  tasks,
  settings: { firstRunAt: 1 },
  profile: { ...defaultProfile(), ...profile },
});
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

// Saturday 10 Oct 2026, 08:00: a day off.  Tuesday 6 Oct 2026, 07:30: a work day.
const SAT = new Date(2026, 9, 10, 8, 0);
const TUE = new Date(2026, 9, 6, 7, 30);
const TODAY_SAT = "2026-10-10";
const TODAY_TUE = "2026-10-06";

describe("Plan my day", () => {
  it("puts work, lunch and commute in as fixed blocks on a work day", () => {
    const plan = buildDayPlan(data([]), TUE);
    const kinds = plan.blocks.map((b) => b.kind);
    expect(kinds).toEqual(expect.arrayContaining(["work", "lunch", "commute"]));
    expect(plan.blocks.every((b) => b.fixed)).toBe(true);
    const work = plan.blocks.find((b) => b.kind === "work")!;
    expect([toHHMM(work.start), toHHMM(work.end)]).toEqual(["09:00", "17:30"]);
  });

  it("no work block on a day off", () => {
    expect(buildDayPlan(data([]), SAT).blocks.some((b) => b.kind === "work")).toBe(false);
  });

  it("adds the gym on gym days", () => {
    const plan = buildDayPlan(data([], { gymDays: [2], gymStart: "18:30", gymMin: 60 }), TUE);
    const gym = plan.blocks.find((b) => b.kind === "gym")!;
    expect(toHHMM(gym.start)).toBe("18:30");
  });

  it("slots tasks into free time, never over a fixed block", () => {
    const tasks = [
      task({ title: "Pay tax", due: TODAY_TUE, estimateMin: 30, important: true }),
      task({ title: "Call gran", due: TODAY_TUE, estimateMin: 15 }),
      task({ title: "Book dentist", due: TODAY_TUE, estimateMin: 10 }),
    ];
    const plan = buildDayPlan(data(tasks, { gymDays: [2] }), TUE);
    const placed = plan.blocks.filter((b) => b.kind === "task");
    expect(placed).toHaveLength(3);
    const fixed = plan.blocks.filter((b) => b.fixed);
    for (const t of placed) {
      for (const f of fixed) expect(overlaps(t, f)).toBe(false);
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false);
  });

  it("only Work-area tasks go into work hours", () => {
    const tasks = [task({ title: "Send deck", area: "work", due: TODAY_TUE, estimateMin: 45 }), task({ title: "Pick up parcel", due: TODAY_TUE, estimateMin: 20 })];
    const plan = buildDayPlan(data(tasks), TUE);
    const work = plan.blocks.find((b) => b.kind === "work")!;
    const deck = plan.blocks.find((b) => b.label === "Send deck")!;
    const parcel = plan.blocks.find((b) => b.label === "Pick up parcel")!;
    expect(deck.start >= work.start && deck.end <= work.end).toBe(true);
    expect(overlaps(parcel, work)).toBe(false);
  });

  it("deep tasks go in the best focus time", () => {
    const t = task({ title: "Write essay", due: TODAY_SAT, estimateMin: 60 });
    const morning = buildDayPlan(data([t], { bestFocus: "morning" }), SAT).blocks.find((b) => b.kind === "task")!;
    const evening = buildDayPlan(data([t], { bestFocus: "evening" }), SAT).blocks.find((b) => b.kind === "task")!;
    expect(morning.start).toBeLessThan(12 * 60);
    expect(evening.start).toBeGreaterThanOrEqual(17 * 60);
  });

  it("things with a set time are fixed events", () => {
    const plan = buildDayPlan(data([task({ title: "Dentist", due: TODAY_SAT, dueTime: "11:00", estimateMin: 45 })]), SAT);
    const ev = plan.blocks.find((b) => b.kind === "event")!;
    expect([toHHMM(ev.start), ev.fixed]).toEqual(["11:00", true]);
  });

  it("leaves out what doesn't fit instead of overbooking", () => {
    const many = Array.from({ length: 12 }, (_, i) => task({ title: `Big ${i}`, due: TODAY_SAT, estimateMin: 90 }));
    const plan = buildDayPlan(data(many), SAT);
    expect(plan.unplaced.length).toBeGreaterThan(0);
    expect(plan.blocks.filter((b) => b.kind === "task").every((b) => b.end <= plan.dayEnd)).toBe(true);
  });

  it("only plans from now onwards", () => {
    const late = new Date(2026, 9, 10, 21, 30); // only ~25 min left before quiet hours at 22:00
    const plan = buildDayPlan(data([task({ title: "Late", due: TODAY_SAT, estimateMin: 45 })]), late);
    expect(plan.blocks.filter((b) => b.kind === "task")).toHaveLength(0);
    expect(plan.unplaced).toHaveLength(1);
  });

  it("gives slot times ready to save", () => {
    const plan = buildDayPlan(data([task({ title: "Tidy", due: TODAY_SAT, estimateMin: 20 })]), SAT);
    const slots = slotsFromPlan(plan);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ min: 20 });
    expect(slots[0].start).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("weekly balance nudge", () => {
  const week = (area: string, n: number) =>
    Array.from({ length: n }, () => task({ area, due: "2026-10-07" }));
  it("flags a week that is all work", () => {
    const n = balanceNudge(data(week("work", 5)), "2026-10-08")!;
    expect(n.message).toBe("All work this week, nothing in Health or Family or Fun.");
  });
  it("only names the areas that are missing", () => {
    const n = balanceNudge(data([...week("work", 5), ...week("family", 1)]), "2026-10-08")!;
    expect(n.message).toContain("nothing in Health or Fun");
    expect(n.message.startsWith("Mostly work")).toBe(true);
  });
  it("stays quiet when life is balanced or there's too little data", () => {
    expect(balanceNudge(data([...week("work", 3), ...week("family", 2), ...week("fun", 1), ...week("health", 1)]), "2026-10-08")).toBeNull();
    expect(balanceNudge(data(week("work", 2)), "2026-10-08")).toBeNull();
  });
});
