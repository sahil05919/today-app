import { describe, expect, it } from "vitest";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { nextNumber, weekProgress } from "../lib/sessions";
import { toHHMM } from "../lib/profile";
import type { AppData, SessionLog } from "../lib/types";

// Monday 5 Oct 2026, 07:00 (week: Mon 5 … Sun 11)
const MON = new Date(2026, 9, 5, 7, 0);
const FRI_EVENING = new Date(2026, 9, 9, 21, 0);
const dayOf = (d: string) => new Date(d + "T00:00:00").getDay();

const base = (over: Partial<AppData> = {}): AppData =>
  seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 }, ...over });

const log = (areaId: string, date: string, n: number): SessionLog => ({ id: `${areaId}${n}`, areaId, date, minutes: 30, n, at: new Date(date + "T19:00:00").getTime(), source: "checkin" });
const count = (plan: ReturnType<typeof planSessions>, area: string) => plan.filter((s) => s.areaId === area && !s.done).length;

describe("seeding", () => {
  it("adds your areas once, with your targets", () => {
    const d = base();
    const t = (id: string) => d.profile!.areas.find((a) => a.id === id)?.target;
    expect(t("powerbi")).toMatchObject({ perWeek: 4, minutes: 60 });
    expect(t("meditation")).toMatchObject({ perWeek: 3, minutes: 15 });
    expect(t("english")).toMatchObject({ perWeek: 7, minutes: 20 });
    expect(t("walking")).toMatchObject({ perWeek: 6, minutes: 35, at: "19:30" });
    expect(d.profile!.areas.some((a) => a.id === "others")).toBe(true);
    expect(d.profile!.workEnd).toBe("17:00");
    expect(d.profile!.eveningWrap).toBe("22:00");
    expect(toHHMM(23 * 60)).toBe(d.profile!.quietStart);
  });
  it("never runs twice (deleting an area sticks)", () => {
    const once = base();
    const trimmed = { ...once, profile: { ...once.profile!, areas: once.profile!.areas.filter((a) => a.id !== "powerbi") } };
    expect(seedIfNeeded(trimmed).profile!.areas.some((a) => a.id === "powerbi")).toBe(false);
  });
  it("leaves hours you've already customised alone", () => {
    const d = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 }, profile: { ...base().profile!, workEnd: "18:15", commuteToMin: 20, setupDone: true, areas: [] } });
    expect(d.profile!.workEnd).toBe("18:15");
  });
});

describe("weekly planner", () => {
  const plan = planSessions(base(), MON);

  it("fills each weekly target", () => {
    expect(count(plan, "powerbi")).toBe(4);
    expect(count(plan, "meditation")).toBe(3);
    expect(count(plan, "job")).toBe(5);
    expect(count(plan, "english")).toBe(7);
    expect(count(plan, "walking")).toBe(6);
  });

  it("spreads: never two of the same area on one day, and never everything on one day", () => {
    for (const area of ["powerbi", "meditation", "job", "english", "walking"]) {
      const days = plan.filter((s) => s.areaId === area).map((s) => s.date);
      expect(new Set(days).size).toBe(days.length);
    }
    const pbi = plan.filter((s) => s.areaId === "powerbi").map((s) => s.date);
    expect(new Set(pbi).size).toBe(4);
    // Evenly spread across Mon-Fri: not 4 days in a row at the start.
    expect(pbi).not.toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
  });

  it("keeps weekends light and only for areas that allow them", () => {
    const weekend = plan.filter((s) => [0, 6].includes(dayOf(s.date)));
    expect(weekend.every((s) => ["english", "walking"].includes(s.areaId))).toBe(true);
    for (const d of ["2026-10-10", "2026-10-11"]) {
      expect(plan.filter((s) => s.date === d).reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(100);
    }
    expect(plan.some((s) => s.areaId === "walking" && [0, 6].includes(dayOf(s.date)))).toBe(true);
  });

  it("runs Power BI first, then the walk at about 19:30", () => {
    const day = plan.find((s) => s.areaId === "walking" && s.start === 19 * 60 + 30 && plan.some((o) => o.areaId === "powerbi" && o.date === s.date));
    expect(day).toBeDefined();
    const pbi = plan.find((s) => s.areaId === "powerbi" && s.date === day!.date)!;
    expect(toHHMM(pbi.start)).toBe("18:00");
    expect(pbi.end).toBeLessThanOrEqual(day!.start);
  });

  it("never overlaps two sessions", () => {
    for (const a of plan) for (const b of plan) if (a !== b && a.date === b.date) expect(a.start < b.end && b.start < a.end).toBe(false);
  });

  it("numbers sessions from your history", () => {
    const logs = Array.from({ length: 13 }, (_, i) => log("powerbi", "2026-09-" + String(10 + i).padStart(2, "0"), i + 1));
    expect(nextNumber(logs, "powerbi")).toBe(14);
    const p = planSessions(base({ sessions: logs }), MON).filter((s) => s.areaId === "powerbi");
    expect(p.map((s) => s.n)).toEqual([14, 15, 16, 17]);
    expect(p[0].title).toBe("Power BI session 14");
  });

  it("alternates Job Prep and Job Apply", () => {
    const j = plan.filter((s) => s.areaId === "job");
    expect(j.map((s) => s.variant)).toEqual(["Job Prep", "Job Apply", "Job Prep", "Job Apply", "Job Prep"]);
  });

  it("counts finished sessions towards the week", () => {
    const logs = ["2026-10-05"].flatMap((d) => [log("powerbi", d, 1)]);
    const p = planSessions(base({ sessions: [...logs, log("powerbi", "2026-10-05", 2)] }), new Date(2026, 9, 6, 7, 0));
    // 2 logs this week (same day counts as 2 sessions logged) → 2 more to plan
    expect(count(p, "powerbi")).toBe(2);
    expect(weekProgress(base({ sessions: logs }), "2026-10-06").find((r) => r.area.id === "powerbi")).toMatchObject({ done: 1, target: 4 });
  });

  it("when behind, packs what's possible into the days left, still not on the weekend", () => {
    const p = planSessions(base(), new Date(2026, 9, 9, 7, 0)); // Friday morning, nothing done yet
    const pbi = p.filter((s) => s.areaId === "powerbi");
    expect(pbi.length).toBeLessThan(4);
    expect(pbi.every((s) => s.date === "2026-10-09")).toBe(true);
  });

  it("fixed events push sessions to other days instead of dropping them", () => {
    const blockWed = (d: string) => (d === "2026-10-07" ? ([[17 * 60, 23 * 60]] as Array<[number, number]>) : []);
    const p = planSessions(base(), MON, blockWed);
    expect(count(p, "powerbi")).toBe(4);
    expect(p.filter((s) => s.date === "2026-10-07" && s.start >= 17 * 60)).toHaveLength(0);
  });

  it("skipped and past slots aren't planned again today", () => {
    const skip = { key: "session:walking:2026-10-05", status: "skip" as const, at: 1 };
    const p = planSessions(base({ log: [skip] }), MON);
    expect(p.some((s) => s.areaId === "walking" && s.date === "2026-10-05")).toBe(false);
    const late = planSessions(base(), FRI_EVENING);
    expect(late.filter((s) => s.date === "2026-10-09" && s.start < 21 * 60)).toHaveLength(0);
  });
});
