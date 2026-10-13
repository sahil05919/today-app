import { describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { addDays, fromISO } from "../lib/dates";
import { capacityLine, capFor, dailyCapacity } from "../lib/dayCapacity";
import { planWeek } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { settleOverflow } from "../lib/settle";
import { buildTimeline } from "../lib/timeline";
import { weekTargets } from "../lib/targets";
import type { AppData, HistoryEvent, Task } from "../lib/types";

const NOW = new Date(2026, 9, 26, 9, 0); // Mon 26 Oct 2026
const TODAY = "2026-10-26";
const isWeekend = (d: string) => [0, 6].includes(fromISO(d).getDay());
let n = 0;

/** A history where every ordinary weekday had `wd` finished items and every weekend day `we` (except the days listed). */
function history(wd: number, we: number, opts: { from?: string; skip?: string[] } = {}): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  const from = opts.from ?? addDays(TODAY, -28);
  for (let d = from; d < TODAY; d = addDays(d, 1)) {
    if (opts.skip?.includes(d)) continue;
    const count = isWeekend(d) ? we : wd;
    for (let i = 0; i < count; i++) out.push({ id: `h${++n}`, at: new Date(`${d}T20:0${i}:00`).getTime(), date: d, kind: "done", type: "task", key: `task:h${n}`, title: `Done ${n}`, createdByMe: true });
  }
  return out;
}
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });
const task = (o: Partial<Task>): Task => ({ id: `c${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, estimateMin: 20, ...o });

describe("3. capacity: what I really finish", () => {
  it("is the median per day, separately for weekdays and weekends, from the last 28 days (20 min each when nothing says otherwise)", () => {
    const c = dailyCapacity(base({ history: history(3, 4) }), TODAY);
    expect(c.ready).toBe(true);
    expect(c.weekday).toMatchObject({ items: 3, minutes: 90 }); // 3 × 20 = 60, floored to 90
    expect(c.weekend).toMatchObject({ items: 4, minutes: 90 });
    const big = dailyCapacity(base({ history: history(5, 6) }), TODAY);
    expect(big.weekday).toMatchObject({ items: 5, minutes: 100 });
    expect(big.weekend).toMatchObject({ items: 6, minutes: 120 });
  });

  it("a quiet fortnight can not drag it under the floor of 2 items", () => {
    const c = dailyCapacity(base({ history: history(0, 0).concat(history(1, 1).slice(0, 10)) }), TODAY);
    expect(c.weekday!.items).toBeGreaterThanOrEqual(2);
  });

  it("off days and days with a cleared window are ignored (they would pull the median down)", () => {
    // Every weekday had 4, except 12 empty ones later on: 10 off days and 2 cleared days (more than half of the weekdays).
    const skipped = ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
    const h = history(4, 4, { skip: skipped });
    const without = dailyCapacity(base({ history: h }), TODAY);
    expect(without.weekday!.items).toBeLessThan(4); // the empty days count as zeros…
    const ignoring = dailyCapacity(
      base({
        history: h,
        offDays: skipped.slice(0, 10),
        cleared: [
          { id: "c1", group: "g", date: "2026-10-12", start: 0, end: 600, at: 1 },
          { id: "c2", group: "g2", date: "2026-10-13", start: 0, end: 600, at: 1 },
        ],
      }),
      TODAY,
    );
    expect(ignoring.weekday!.items).toBe(4);
  });

  it("counts what was undone as not finished, and ignores routine blocks (lunch, commute)", () => {
    const h = history(3, 3);
    const d = base({
      history: [
        ...h,
        ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, at: new Date(`${addDays(TODAY, -(i % 20) - 1)}T13:00:00`).getTime(), date: addDays(TODAY, -(i % 20) - 1), kind: "done" as const, type: "routine" as const, key: `block:lunch:${i}`, title: "Lunch", createdByMe: false })),
      ],
    });
    expect(dailyCapacity(d, TODAY).weekday!.items).toBe(3);
  });

  it("cold start: under 14 days of history nothing is learned and the old limits apply", () => {
    const young = base({ history: history(3, 4, { from: addDays(TODAY, -9) }) });
    const c = dailyCapacity(young, TODAY);
    expect(c.ready).toBe(false);
    expect(capFor(young, "2026-10-27", TODAY)).toBeNull();
    expect(capacityLine(young, TODAY)).toMatch(/Still learning .*9 of 14 days/);
    expect(capFor(base(), "2026-10-27", TODAY)).toBeNull();
  });

  it("the quiet line in Settings, and the manual override", () => {
    const d = base({ history: history(3, 4) });
    expect(capacityLine(d, TODAY)).toBe("Planning about 3 items on weekdays, 4 items on weekends (based on your last 4 weeks).");
    const set = { ...d, profile: { ...d.profile!, capacityItems: 2 } };
    expect(capacityLine(set, TODAY)).toBe("Planning 2 items a day (your setting).");
    expect(capFor(set, "2026-10-27", TODAY)).toMatchObject({ items: 2 });
    expect(capFor(set, "2026-10-31", TODAY)).toMatchObject({ items: 2 });
  });
});

describe("3. the planner keeps to it", () => {
  const learned = (wd = 3, we = 4) => base({ history: history(wd, we) });

  it("a day never gets more flexible items than capacity: extra tasks wait for a lighter day, none is lost", () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task({ title: `Errand ${i}`, due: "2026-10-31", area: "home" })); // a Saturday
    const l = learned(3, 4);
    // (no weekly targets here, so only the tasks compete for the day: the other days are light)
    const d = { ...l, profile: { ...l.profile!, areas: l.profile!.areas.map((a) => ({ ...a, target: undefined })) }, tasks };
    const tl = buildTimeline(d, "2026-10-31", new Date(2026, 9, 31));
    // Sessions and tasks together stay within the Saturday capacity (4); bills and life admin have their own days and are not held back.
    const flexible = tl.items.filter((x) => !x.muted && !x.allDay && !x.skipped && (x.kind === "session" || (x.kind === "task" && !x.fixed && x.title.startsWith("Errand"))));
    expect(flexible.length).toBeLessThanOrEqual(4);
    expect(tl.overflow.length).toBeGreaterThan(0);
    // The overflow is settled onto other days; every task is still there with a date.
    const moves = settleOverflow(d, new Date(2026, 9, 31));
    expect(moves.length).toBeGreaterThan(0);
    expect(new Set(moves.map((m) => m.taskId)).size).toBe(moves.length);
    for (const m of moves) expect(m.to).not.toBe("2026-10-31");
  });

  it("without learned capacity the same day takes what the evening allows (the old behaviour)", () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task({ title: `Errand ${i}`, due: "2026-10-31", area: "home" }));
    const cold = { ...base(), tasks };
    const warm = { ...learned(2, 2), tasks };
    const count = (d: AppData) => buildTimeline(d, "2026-10-31", new Date(2026, 9, 31)).items.filter((x) => x.kind === "task" && !x.fixed).length;
    expect(count(cold)).toBeGreaterThan(count(warm));
  });

  it("overdue tasks are never held back by the cap", () => {
    const d = { ...learned(2, 2), tasks: [task({ title: "Late thing", due: "2026-10-20", important: true }), ...Array.from({ length: 6 }, (_, i) => task({ title: `Today ${i}`, due: TODAY }))] };
    const tl = buildTimeline(d, TODAY, NOW);
    expect(tl.items.some((x) => x.title === "Late thing")).toBe(true);
  });

  it("sessions are capped per day too, and weekly targets stay a hard rule: placed, or reported with how many fit", () => {
    const capped = learned(2, 2);
    const { sessions, short } = planWeek(capped, NOW);
    for (let i = 0; i < 7; i++) {
      const day = addDays(TODAY, i);
      expect(sessions.filter((s) => s.date === day).length, day).toBeLessThanOrEqual(2);
    }
    // Four tracked areas want ~25 sessions this week; 2 a day is 14, so the rest is REPORTED, never silently dropped.
    expect(short.length).toBeGreaterThan(0);
    const t = weekTargets(capped, NOW);
    for (const r of t.rows) {
      const s = t.short.find((x) => x.areaId === r.areaId);
      if (s) expect(s.fit).toBe(r.fit);
      else expect(r.fit).toBeGreaterThanOrEqual(r.target);
    }
    // …and the number of sessions placed + reported adds up to the targets.
    for (const r of t.rows) expect(r.fit).toBe(sessions.filter((s) => s.areaId === r.areaId).length);
  });

  it("never above the existing caps: a huge capacity changes nothing", () => {
    const huge = { ...base(), profile: { ...base().profile!, capacityItems: 20 } };
    const a = planWeek(base(), NOW).sessions.map((s) => `${s.date} ${s.start} ${s.title}`);
    const b = planWeek(huge, NOW).sessions.map((s) => `${s.date} ${s.start} ${s.title}`);
    expect(b).toEqual(a);
  });

  it("cold start plans exactly as before", () => {
    const young = base({ history: history(1, 1, { from: addDays(TODAY, -5) }) });
    expect(planWeek(young, NOW).sessions.map((s) => `${s.date} ${s.start} ${s.title}`)).toEqual(planWeek(base(), NOW).sessions.map((s) => `${s.date} ${s.start} ${s.title}`));
  });
});
