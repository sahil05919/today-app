import { describe, expect, it } from "vitest";
import { computeNudges } from "../lib/nudges";
import { planNotifications } from "../lib/notifications/plan";
import { OFF_LIMIT_MESSAGE, canTakeOffDay, isOffDay, offDaysLeft, offDaysThisWeek } from "../lib/offday";
import { dots, encouragement, streak, weeklyPercent } from "../lib/progress";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { weekProgress } from "../lib/sessions";
import type { AppData, SessionLog } from "../lib/types";

// Week of Mon 5 – Sun 11 Oct 2026.
const MON = new Date(2026, 9, 5, 7, 0);
const base = (over: Partial<AppData> = {}): AppData => seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() }, ...over }, MON);
const log = (areaId: string, date: string, n = 1): SessionLog => ({ id: `${areaId}${date}${n}`, areaId, date, minutes: 30, n, at: new Date(date + "T19:00:00").getTime(), source: "checkin" });
const count = (plan: ReturnType<typeof planSessions>, id: string) => plan.filter((s) => s.areaId === id && !s.done).length;
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("off days: at most two a week", () => {
  it("counts the off days in the current Mon–Sun week and shows how many are left", () => {
    const d = base({ offDays: ["2026-10-06"] });
    expect(offDaysThisWeek(d, "2026-10-08")).toEqual(["2026-10-06"]);
    expect(offDaysLeft(d, "2026-10-08")).toBe(1);
    expect(offDaysLeft(base(), "2026-10-08")).toBe(2);
  });

  it("after two, a third is refused, with your message", () => {
    const d = base({ offDays: ["2026-10-06", "2026-10-07"] });
    expect(offDaysLeft(d, "2026-10-08")).toBe(0);
    expect(canTakeOffDay(d, "2026-10-08")).toBe(false);
    expect(OFF_LIMIT_MESSAGE).toBe("You've had your 2 off days this week. Let's do even one small session.");
  });

  it("the limit resets on Monday, and last week's off days don't count", () => {
    const d = base({ offDays: ["2026-10-01", "2026-10-02"] }); // Thu, Fri of the week before
    expect(offDaysLeft(d, "2026-10-06")).toBe(2);
    expect(canTakeOffDay(d, "2026-10-06")).toBe(true);
  });

  it("a day can't be taken off twice", () => {
    expect(canTakeOffDay(base({ offDays: ["2026-10-06"] }), "2026-10-06")).toBe(false);
    expect(isOffDay(base({ offDays: ["2026-10-06"] }), "2026-10-06")).toBe(true);
  });
});

describe("an off day lightens the day and spreads the rest", () => {
  const normal = planSessions(base(), MON);
  const off = planSessions(base({ offDays: ["2026-10-07"] }), MON); // Wednesday off
  const onWed = (p: typeof off) => p.filter((s) => s.date === "2026-10-07");

  it("keeps exactly one short session", () => {
    expect(onWed(normal).length).toBeGreaterThan(2);
    expect(onWed(off)).toHaveLength(1);
    expect(onWed(off)[0].minutes).toBeLessThanOrEqual(20);
  });

  it("moves the longer sessions to the other days instead of dropping them", () => {
    expect(count(off, "powerbi")).toBe(4);
    expect(count(off, "walking")).toBeGreaterThanOrEqual(5);
    expect(off.some((s) => s.areaId === "powerbi" && s.date === "2026-10-07")).toBe(false);
  });

  it("never piles the rest onto one day", () => {
    const perDay = new Map<string, number>();
    for (const s of off) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(Math.max(...[...new Set(normal.map((s) => s.date))].map((d) => normal.filter((s) => s.date === d).length)) + 1);
  });

  it("if you've already done something that day, nothing more is planned", () => {
    const p = planSessions(base({ offDays: ["2026-10-07"], sessions: [log("meditation", "2026-10-07")] }), new Date(2026, 9, 7, 7, 0));
    expect(p.filter((s) => s.date === "2026-10-07" && !s.done)).toHaveLength(0);
  });

  it("only one session at a time, even for two off days", () => {
    const p = planSessions(base({ offDays: ["2026-10-07", "2026-10-08"] }), MON);
    for (const d of ["2026-10-07", "2026-10-08"]) expect(p.filter((s) => s.date === d).length).toBeLessThanOrEqual(1);
  });

  it("is quiet: no daily pings, no nudges, a gentle morning message", () => {
    const d = base({ offDays: ["2026-10-07"] });
    const list = planNotifications(d, MON);
    expect(list.some((n) => n.key.startsWith("rhythm:") && n.key.endsWith("2026-10-07"))).toBe(false);
    expect(list.some((n) => n.key.startsWith("rhythm:") && n.key.endsWith("2026-10-08"))).toBe(true); // other days unchanged
    expect(list.find((n) => n.key === "morning:2026-10-07")!.title).toBe("Easy day, Sahil");
    expect(computeNudges(d, new Date(2026, 9, 7, 20, 0))).toEqual([]);
    expect(hm(list.find((n) => n.key === "morning:2026-10-07")!.at)).toBe("08:00");
  });
});

describe("progress: one glance", () => {
  it("one number: sessions done against the weekly targets", () => {
    expect(weeklyPercent(base(), "2026-10-07")).toEqual({ pct: 0, done: 0, target: 25 });
    const d = base({ sessions: [log("powerbi", "2026-10-05"), log("powerbi", "2026-10-06", 2), log("powerbi", "2026-10-07", 3)] });
    expect(weeklyPercent(d, "2026-10-07")).toEqual({ pct: 12, done: 3, target: 25 });
  });

  it("an area can't count past its own target", () => {
    const many = ["05", "06", "07", "08", "09", "10"].map((x, i) => log("powerbi", `2026-10-${x}`, i + 1));
    expect(weeklyPercent(base({ sessions: many }), "2026-10-10").done).toBe(4);
  });

  it("a whole week of targets is 100%", () => {
    const rows = weekProgress(base(), "2026-10-07");
    const sessions: SessionLog[] = [];
    rows.forEach((r) => {
      for (let i = 0; i < r.target; i++) sessions.push(log(r.area.id, `2026-10-${String(5 + i).padStart(2, "0")}`, i + 1));
    });
    expect(weeklyPercent(base({ sessions }), "2026-10-11").pct).toBe(100);
  });

  it("dots: ●●●○ for 3 of 4", () => {
    const d = base({ sessions: ["05", "06", "07"].map((x, i) => log("powerbi", `2026-10-${x}`, i + 1)) });
    const pbi = weekProgress(d, "2026-10-07").find((r) => r.area.id === "powerbi")!;
    expect(dots(pbi)).toEqual({ filled: 3, total: 4 });
    expect(dots(weekProgress(base(), "2026-10-07").find((r) => r.area.id === "english")!)).toEqual({ filled: 0, total: 7 });
  });
});

describe("streak", () => {
  const days = (...ds: string[]) => ds.map((d, i) => log("meditation", d, i + 1));

  it("counts days in a row with a session", () => {
    const d = base({ sessions: days("2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06") });
    expect(streak(d, "2026-10-06")).toEqual({ days: 4, doneToday: true });
  });

  it("today not being done yet doesn't break it", () => {
    const d = base({ sessions: days("2026-10-04", "2026-10-05") });
    expect(streak(d, "2026-10-06")).toEqual({ days: 2, doneToday: false });
  });

  it("a missed day breaks it", () => {
    expect(streak(base({ sessions: days("2026-10-03", "2026-10-05", "2026-10-06") }), "2026-10-06").days).toBe(2);
  });

  it("an off day neither adds to it nor breaks it", () => {
    const d = base({ sessions: days("2026-10-04", "2026-10-06"), offDays: ["2026-10-05"] });
    expect(streak(d, "2026-10-06").days).toBe(2);
    expect(streak({ ...d, offDays: [] }, "2026-10-06").days).toBe(1);
  });

  it("a day blocked by an all-day event doesn't break it either", () => {
    const d = base({ sessions: days("2026-10-04", "2026-10-06"), events: [{ id: "e", title: "Trip", date: "2026-10-05", createdAt: 1 }] });
    expect(streak(d, "2026-10-06").days).toBe(2);
  });

  it("starts from zero with no sessions at all", () => {
    expect(streak(base(), "2026-10-06")).toEqual({ days: 0, doneToday: false });
  });
});

describe("one encouraging line a day", () => {
  it("is the same all day and changes day to day", () => {
    const d = base();
    expect(encouragement(d, "2026-10-08")).toBe(encouragement(d, "2026-10-08"));
    const week = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map((x) => encouragement(d, x));
    expect(new Set(week).size).toBeGreaterThan(1);
  });
  it("is kind on an off day, and warm when the week is done", () => {
    expect(encouragement(base({ offDays: ["2026-10-08"] }), "2026-10-08")).toMatch(/rest|easy|recharge/i);
    const rows = weekProgress(base(), "2026-10-07");
    const sessions: SessionLog[] = [];
    rows.forEach((r) => {
      for (let i = 0; i < r.target; i++) sessions.push(log(r.area.id, `2026-10-${String(5 + i).padStart(2, "0")}`, i + 1));
    });
    expect(encouragement(base({ sessions }), "2026-10-11")).toMatch(/week|done|target/i);
  });
  it("never nags", () => {
    const d = base();
    for (const day of ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-10"]) {
      expect(encouragement(d, day)).not.toMatch(/should|must|behind|failed|lazy|!/i);
    }
  });
});
