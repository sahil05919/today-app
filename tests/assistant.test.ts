import { describe, expect, it } from "vitest";
import { allNextOccurrences, resolveRule, CURATED_EVENTS, upcomingEvents } from "../lib/events";
import { remainingMinutes } from "../lib/estimate";
import { planRescue } from "../lib/rescue";
import { actualMinutes, bestDay, buildDurationModel, completionRate, estimateAccuracy, weekStart } from "../lib/stats";
import type { Task } from "../lib/types";

const ev = (id: string) => CURATED_EVENTS.find((e) => e.id === id)!;

describe("London events", () => {
  it("Notting Hill Carnival is the August bank holiday Sunday + Monday", () => {
    // Last Monday of Aug 2026 is the 31st; of Aug 2025 is the 25th.
    expect(resolveRule(ev("notting-hill-carnival").rule, 2026)).toEqual({ start: "2026-08-30", end: "2026-08-31" });
    expect(resolveRule(ev("notting-hill-carnival").rule, 2025)).toEqual({ start: "2025-08-24", end: "2025-08-25" });
  });
  it("Open House is the third weekend of September", () => {
    expect(resolveRule(ev("open-house-london").rule, 2026)).toEqual({ start: "2026-09-19", end: "2026-09-20" });
  });
  it("Lord Mayor's Show is the second Saturday of November", () => {
    expect(resolveRule(ev("lord-mayors-show").rule, 2026).start).toBe("2026-11-14");
    expect(resolveRule(ev("lord-mayors-show").rule, 2025).start).toBe("2025-11-08");
  });
  it("Remembrance Sunday is the Sunday nearest 11 Nov", () => {
    expect(resolveRule(ev("remembrance-sunday").rule, 2026).start).toBe("2026-11-08");
    expect(resolveRule(ev("remembrance-sunday").rule, 2025).start).toBe("2025-11-09");
  });
  it("ranges can run into the next year", () => {
    expect(resolveRule(ev("winter-wonderland").rule, 2026)).toEqual({ start: "2026-11-14", end: "2027-01-04" });
  });
  it("shows events from two weeks before they start", () => {
    const ids = (d: string) => upcomingEvents(d).map((u) => u.event.id);
    expect(ids("2026-10-06")).toContain("diwali-trafalgar"); // starts 15 Oct
    expect(ids("2026-10-06")).toContain("frieze-london"); // starts 8 Oct
    expect(ids("2026-10-06")).not.toContain("bonfire-night"); // starts 1 Nov, still too far
    expect(ids("2026-10-20")).toContain("bonfire-night");
    expect(ids("2026-03-01")).not.toContain("notting-hill-carnival");
  });
  it("hides events the user dismissed for that year", () => {
    const hidden = upcomingEvents("2026-10-06", { hidden: ["frieze-london:2026"] }).map((u) => u.event.id);
    expect(hidden).not.toContain("frieze-london");
  });
  it("every event resolves to a valid, ordered date range, and has a next occurrence", () => {
    for (const e of CURATED_EVENTS) {
      const { start, end } = resolveRule(e.rule, 2026);
      expect(start <= end).toBe(true);
    }
    expect(allNextOccurrences("2026-10-06")).toHaveLength(CURATED_EVENTS.length);
  });
});

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
const done = (over: Partial<Task>, min: number) =>
  task({ status: "done", completedAt: Date.now(), sessions: [{ at: Date.now(), min }], ...over });

describe("duration model", () => {
  it("needs enough samples before it trusts itself", () => {
    expect(buildDurationModel([done({ estimateMin: 30 }, 60)]).multiplier).toBeUndefined();
  });
  it("learns that you take twice your estimates", () => {
    const m = buildDurationModel([done({ estimateMin: 30 }, 60), done({ estimateMin: 20 }, 40), done({ estimateMin: 10 }, 20)]);
    expect(m.multiplier).toBeCloseTo(2);
    expect(remainingMinutes(task({ estimateMin: 30 }), m)).toMatchObject({ minutes: 60, learned: true });
  });
  it("uses real averages for similar un-timed tasks", () => {
    const m = buildDurationModel([done({ title: "Email boss" }, 10), done({ title: "Email Sam" }, 20)]);
    expect(m.byKey.email).toEqual({ avg: 15, n: 2 });
    expect(remainingMinutes(task({ title: "Email landlord" }), m)).toMatchObject({ minutes: 15, learned: true, guessed: false });
  });
  it("Rescue uses the learned numbers", () => {
    const m = buildDurationModel([done({ estimateMin: 30 }, 60), done({ estimateMin: 20 }, 40), done({ estimateMin: 10 }, 20)]);
    const t = task({ title: "Write plan", estimateMin: 30, due: "2026-10-06" });
    expect(planRescue([t], 45, "2026-10-06", m).items).toHaveLength(0); // really 60 min
    expect(planRescue([t], 45, "2026-10-06").items).toHaveLength(1); // without history, 30 fits
  });
});

describe("patterns", () => {
  it("weekStart is the Monday", () => {
    expect(weekStart("2026-10-06")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
  });
  it("completion rate", () => {
    const tasks = [done({}, 5), done({}, 5), done({}, 5), task({ due: "2026-10-01" })];
    expect(completionRate(tasks, "2026-10-06", 365)).toMatchObject({ done: 3, missed: 1, rate: 0.75 });
  });
  it("estimate accuracy", () => {
    const tasks = [done({ estimateMin: 30 }, 30), done({ estimateMin: 20 }, 40), done({ estimateMin: 10 }, 11)];
    const a = estimateAccuracy(tasks)!;
    expect(a.n).toBe(3);
    expect(a.within).toBe(67);
  });
  it("best day needs a handful of completions", () => {
    expect(bestDay([done({}, 5)], new Date().toISOString().slice(0, 10))).toBeNull();
  });
  it("actualMinutes sums sessions", () => {
    expect(actualMinutes(task({ sessions: [{ at: 1, min: 10 }, { at: 2, min: 5 }] }))).toBe(15);
  });
});
