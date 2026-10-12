import { describe, expect, it } from "vitest";
import { planWeek } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { makeSeries } from "../lib/series";
import { dayChoices, shortLine, weekTargets } from "../lib/targets";
import type { AppData, FixedEvent } from "../lib/types";

const seeded = (over: Partial<AppData> = {}): AppData => seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() }, ...over }, new Date(2026, 9, 12));
const ev = (id: string, date: string, start: string, end: string): FixedEvent => ({ id, title: id, date, start, end, createdAt: 1 });
const MON = new Date(2026, 9, 12, 7, 0);
const vit = makeSeries({ id: "vit", title: "All Vitamin", time: "11:00", rule: { freq: "daily", interval: 1 }, from: "2026-10-12" });

// What a normal week of this data looks like: the vitamin, evening calendar events (a shift, a class, dinner), the usual bills.
const NORMAL = seeded({
  series: [vit],
  events: [ev("class", "2026-10-13", "18:30", "20:00"), ev("dinner", "2026-10-15", "19:00", "21:00"), ev("call", "2026-10-14", "18:00", "19:30")],
  calendarEvents: [{ id: "cal:1:2026-10-16", calId: "1", title: "Shift", date: "2026-10-16", start: "18:00", end: "21:00", createdAt: 1, source: "calendar" }],
});

describe("1b. weekly targets are a hard rule", () => {
  it("every area reaches its target in a normal week", () => {
    const t = weekTargets(NORMAL, MON);
    expect(t.short).toEqual([]);
    for (const r of t.rows) expect(r.fit, r.name).toBeGreaterThanOrEqual(r.target);
    expect(t.rows.find((r) => r.areaId === "powerbi")).toMatchObject({ target: 4, plannedCount: 4 });
  });

  it("Power BI keeps its 4 even when most evenings are taken (the case that left a week with none)", () => {
    const busy = seeded({ events: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((d, i) => ev("e" + i, d, "18:30", "20:30")) });
    // Monday: all four. Later in the week the room is shared with the other areas, but it is never none, and the rest is reported.
    expect(weekTargets(busy, MON).rows.find((r) => r.areaId === "powerbi")!.plannedCount).toBe(4);
    for (const now of [new Date(2026, 9, 13, 9, 0), new Date(2026, 9, 14, 12, 0), new Date(2026, 9, 15, 12, 0)]) {
      const t = weekTargets(busy, now);
      const pbi = t.rows.find((r) => r.areaId === "powerbi")!;
      expect(pbi.fit, now.toString()).toBeGreaterThanOrEqual(2);
      expect(t.short.some((s) => s.areaId === "powerbi") === pbi.fit < 4, now.toString()).toBe(true);
    }
  });

  it("no area has two sessions a day in a normal week, and weekends stay within their cap", () => {
    const { sessions } = weekTargets(NORMAL, MON);
    for (const a of new Set(sessions.map((s) => s.areaId))) {
      const days = sessions.filter((s) => s.areaId === a).map((s) => s.date);
      expect(new Set(days).size, a).toBe(days.length);
    }
    for (const d of ["2026-10-17", "2026-10-18"]) expect(sessions.filter((s) => s.date === d).reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(160);
  });

  it("nothing overlaps: a session never sits on an event or another session", () => {
    const { sessions } = weekTargets(NORMAL, MON);
    for (const d of new Set(sessions.map((s) => s.date))) {
      const day = sessions.filter((s) => s.date === d).sort((a, b) => a.start - b.start);
      for (let i = 1; i < day.length; i++) expect(day[i].start, d).toBeGreaterThanOrEqual(day[i - 1].end);
    }
    const dinner = sessions.filter((s) => s.date === "2026-10-15" && s.start < 21 * 60 && s.end > 19 * 60);
    expect(dinner).toEqual([]);
  });

  it("what truly cannot fit is reported with how many do, never dropped", () => {
    const late = new Date(2026, 9, 16, 20, 0); // Friday 20:00 with nothing done: a day cannot hold a week
    const t = weekTargets(seeded(), late);
    expect(t.short.length).toBeGreaterThan(0);
    const pbi = t.short.find((s) => s.areaId === "powerbi");
    if (pbi) expect(shortLine(pbi)).toBe(`Power BI: ${pbi.fit} of 4 fit this week. Tap to choose`);
    for (const s of t.short) expect(t.rows.find((r) => r.areaId === s.areaId)!.missing).toBe(s.target - s.fit);
    // And the people can still choose a day for one more.
    expect(dayChoices(seeded(), "powerbi", late).length).toBeGreaterThan(0);
  });

  it("an area that is done for the week is not planned again", () => {
    const logs = Array.from({ length: 4 }, (_, i) => ({ id: "p" + i, areaId: "powerbi", date: `2026-10-${12 + i}`, minutes: 60, n: i + 1, at: 1, source: "manual" as const }));
    const t = weekTargets(seeded({ sessions: logs }), new Date(2026, 9, 16, 7, 0));
    expect(t.rows.find((r) => r.areaId === "powerbi")).toMatchObject({ done: 4, plannedCount: 0, missing: 0 });
    expect(planWeek(seeded({ sessions: logs }), new Date(2026, 9, 16, 7, 0)).short.some((s) => s.areaId === "powerbi")).toBe(false);
  });
});
