import { describe, expect, it } from "vitest";
import { dayRules } from "../lib/busy";
import { parseCapture } from "../lib/parse";
import { toHHMM, toMin } from "../lib/profile";
import { seedIfNeeded } from "../lib/seed";
import { settleOverflow } from "../lib/settle";
import { buildTimeline, firstThing, isNight, movedNote, nextUp, type TLItem } from "../lib/timeline";
import type { AppData, FixedEvent, Task } from "../lib/types";

// Tue 6 Oct 2026. Mon 5 is the (default) office day. Sat 10 / Sun 11 are the weekend.
const TUE_7 = new Date(2026, 9, 6, 7, 0);
const MON_7 = new Date(2026, 9, 5, 7, 0);
const TUE = "2026-10-06";
const MON = "2026-10-05";
const SAT = "2026-10-10";

let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `t${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (tasks: Task[] = [], extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, MON_7), tasks, ...extra });
const ev = (o: Partial<FixedEvent>): FixedEvent => ({ id: `e${++n}`, title: "Dinner", date: TUE, createdAt: 1, ...o });

const live = (items: TLItem[]) => items.filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay);
const title = (items: TLItem[], t: string) => items.find((x) => x.title === t);

/** No two live items overlap unless both are fixed (two things you booked at once). Flexible items keep the buffer. */
function expectNoOverlap(items: TLItem[], buffer = 10) {
  const l = live(items);
  for (let i = 0; i < l.length; i++) {
    for (let j = i + 1; j < l.length; j++) {
      const [a, b] = [l[i], l[j]];
      const overlap = a.start < b.end && b.start < a.end;
      if (a.fixed && b.fixed) continue;
      expect(overlap, `${a.title} overlaps ${b.title}`).toBe(false);
      const gap = a.start >= b.end ? a.start - b.end : b.start - a.end;
      expect(gap, `${a.title} / ${b.title} need a ${buffer} min buffer`).toBeGreaterThanOrEqual(buffer);
    }
  }
}

describe("the day is one chronological timeline", () => {
  it("puts an item with a time in its exact place between the others", () => {
    const d = base([task({ title: "Fill form", due: TUE, dueTime: "15:00", estimateMin: 20 }), task({ title: "Dentist", due: TUE, dueTime: "14:00", estimateMin: 30 }), task({ title: "Team sync", due: TUE, dueTime: "16:00", estimateMin: 30 })]);
    const tl = buildTimeline(d, TUE, TUE_7);
    const order = tl.items.filter((x) => ["Dentist", "Fill form", "Team sync"].includes(x.title)).map((x) => x.title);
    expect(order).toEqual(["Dentist", "Fill form", "Team sync"]);
    expect(toHHMM(title(tl.items, "Fill form")!.start)).toBe("15:00");
  });

  it("is sorted by start time", () => {
    const tl = buildTimeline(base([task({ title: "Reply to Sam", due: TUE, estimateMin: 15 })]), TUE, TUE_7);
    const starts = tl.items.filter((x) => !x.allDay).map((x) => x.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("puts an untimed task into a free gap on its own", () => {
    const tl = buildTimeline(base([task({ title: "Reply to Sam", due: TUE, estimateMin: 15, area: "family" })]), TUE, TUE_7);
    const it = title(tl.items, "Reply to Sam")!;
    expect(it).toBeDefined();
    expect(it.fixed).toBe(false);
    // a personal task stays out of work hours (09:00-17:00 on a work day)
    expect(it.start >= toMin("17:00") || it.end <= toMin("09:00")).toBe(true);
  });

  it("an item with a time never moves, and flexible items move around it", () => {
    const before = buildTimeline(base(), TUE, TUE_7);
    const walk = title(before.items, "Walking session 1")!;
    const d = base([task({ title: "Fill form", due: TUE, dueTime: toHHMM(walk.start), estimateMin: 30 })]);
    const after = buildTimeline(d, TUE, TUE_7);
    const form = title(after.items, "Fill form")!;
    expect(toHHMM(form.start)).toBe(toHHMM(walk.start));
    const walk2 = title(after.items, "Walking session 1");
    if (walk2) expect(walk2.start >= form.end + 10 || walk2.end + 10 <= form.start).toBe(true);
    expectNoOverlap(after.items);
  });

  it("says what moved in one line", () => {
    const before = buildTimeline(base(), TUE, TUE_7);
    const walk = title(before.items, "Walking session 1")!;
    const d = base([task({ title: "Fill form", due: TUE, dueTime: toHHMM(walk.start), estimateMin: 30 })]);
    const note = movedNote(before, buildTimeline(d, TUE, TUE_7), "Fill form");
    expect(note).toMatch(/^(Moved .* to \d\d:\d\d|Walking moves to another day)/);
    expect(note).toContain("Fill form");
    expect(note!.split("\n")).toHaveLength(1);
  });

  it("reads like 'Moved Power BI to 18:30 to fit your form' when a session just shifts later", () => {
    const before = buildTimeline(base(), TUE, TUE_7);
    const pbi = title(before.items, "Power BI session 1")!;
    expect(toHHMM(pbi.start)).toBe("18:00");
    const d = base([task({ title: "Form", due: TUE, dueTime: "18:00", estimateMin: 20 })]);
    const after = buildTimeline(d, TUE, TUE_7);
    expect(movedNote(before, after, "Form")).toMatch(/^Moved Power BI to 18:30 to fit “Form”( \(and \d+ more\))?\.$/);
  });

  it("no note when nothing had to move", () => {
    const before = buildTimeline(base(), TUE, TUE_7);
    const after = buildTimeline(base([task({ title: "Call mum", due: TUE, dueTime: "11:00", estimateMin: 15 })]), TUE, TUE_7);
    expect(movedNote(before, after, "Call mum")).toBeNull();
  });
});

describe("realistic plans", () => {
  const messy = () =>
    base(
      [
        task({ title: "A", due: TUE, estimateMin: 25, area: "admin" }),
        task({ title: "B", due: TUE, estimateMin: 40, area: "shopping", important: true }),
        task({ title: "C", due: TUE, estimateMin: 10, area: "family" }),
        task({ title: "Overdue 1", due: "2026-10-02", estimateMin: 20, area: "finance" }),
        task({ title: "Overdue 2", due: "2026-10-04", estimateMin: 30, area: "home" }),
        task({ title: "Form", due: TUE, dueTime: "15:00", estimateMin: 20 }),
        task({ title: "Standup", due: TUE, dueTime: "09:30", estimateMin: 30, area: "work" }),
        task({ title: "Dev review", due: TUE, estimateMin: 45, area: "work" }),
      ],
      { events: [ev({ title: "Dinner", start: "19:00", end: "20:30" })] },
    );

  it("never overlaps, and keeps a 10 minute buffer", () => {
    for (const [date, now] of [[TUE, TUE_7], [TUE, new Date(2026, 9, 6, 16, 20)], [MON, MON_7], [SAT, TUE_7]] as const) {
      expectNoOverlap(buildTimeline(messy(), date, now).items);
    }
  });

  it("keeps 17:00-18:00 free on weekdays", () => {
    const tl = buildTimeline(messy(), TUE, TUE_7);
    const tea = tl.items.find((x) => x.key === "break:tea")!;
    expect([toHHMM(tea.start), toHHMM(tea.end)]).toEqual(["17:00", "18:00"]);
    for (const it of live(tl.items)) expect(it.start < 18 * 60 && it.end > 17 * 60, `${it.title} sits in the tea break`).toBe(false);
  });

  it("has no tea break at the weekend", () => {
    expect(buildTimeline(messy(), SAT, TUE_7).items.some((x) => x.key === "break:tea")).toBe(false);
  });

  it("caps the evening at about 2.5 hours", () => {
    const tl = buildTimeline(messy(), TUE, TUE_7);
    const evening = live(tl.items)
      .filter((x) => x.kind !== "bill" && x.kind !== "chore")
      .reduce((m, x) => m + Math.max(0, x.end - Math.max(x.start, 18 * 60)), 0);
    expect(evening).toBeLessThanOrEqual(150 * 1.1 + 45);
    expect(tl.overflow.length).toBeGreaterThan(0); // not everything fits, so something is deferred
  });

  it("an office day has the commute and a lighter evening", () => {
    const tl = buildTimeline(base(), MON, MON_7);
    expect(tl.rules.office).toBe(true);
    expect(tl.rules.eveningCap).toBe(90);
    const to = tl.items.find((x) => x.key === "commute:to")!;
    const from = tl.items.find((x) => x.key === "commute:from")!;
    expect(to.end).toBe(toMin("09:00"));
    expect(from.start).toBe(toMin("17:00"));
    // the tea break comes after getting home
    const tea = tl.items.find((x) => x.key === "break:tea")!;
    expect(tea.start).toBeGreaterThanOrEqual(from.end);
    const tue = buildTimeline(base(), TUE, MON_7);
    const load = (t: typeof tl) => live(t.items).filter((x) => x.kind === "session").reduce((m, x) => m + (x.end - x.start), 0);
    expect(load(tl)).toBeLessThan(load(tue));
  });

  it("Monday is the office day by default and it is editable", () => {
    expect(dayRules(base(), MON).office).toBe(true);
    const wed = base([], { profile: { ...base().profile!, officeDays: [3] } });
    expect(dayRules(wed, "2026-10-07").office).toBe(true);
    expect(dayRules(wed, MON).office).toBe(false);
  });

  it("a weekend has no work hours and plenty of day", () => {
    const tl = buildTimeline(base([task({ title: "Buy shoes", due: SAT, estimateMin: 40, area: "shopping" })]), SAT, TUE_7);
    const shoes = title(tl.items, "Buy shoes")!;
    expect(shoes.start).toBeGreaterThanOrEqual(9 * 60);
    expect(tl.rules.work).toBeNull();
  });

  it("calendar events are fixed blocks", () => {
    const d = base([], { calendarEvents: [ev({ title: "Dentist (Google)", start: "10:00", end: "11:00", source: "calendar", calId: "x1" })] });
    const tl = buildTimeline(d, TUE, TUE_7);
    const it = title(tl.items, "Dentist (Google)")!;
    expect([it.kind, it.fixed, toHHMM(it.start)]).toEqual(["calendar", true, "10:00"]);
  });

  it("all-day events sit at the top and block the day for sessions", () => {
    const d = base([], { events: [ev({ title: "Holiday", start: undefined })] });
    const tl = buildTimeline(d, TUE, TUE_7);
    expect(tl.items[0].title).toBe("Holiday");
    expect(tl.items.some((x) => x.kind === "session" && !x.done)).toBe(false);
  });

  it("two things you booked at once are reported as a clash, not hidden", () => {
    const d = base([task({ title: "Form", due: TUE, dueTime: "15:00", estimateMin: 30 })], { events: [ev({ title: "Call", start: "15:15", end: "16:00" })] });
    expect(buildTimeline(d, TUE, TUE_7).clashes).toHaveLength(1);
  });

  it("random days never overlap", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 40; run++) {
      const tasks: Task[] = [];
      for (let k = 0; k < 2 + Math.floor(rnd() * 8); k++) {
        const hasTime = rnd() < 0.3;
        tasks.push(
          task({
            title: `T${run}-${k}`,
            due: rnd() < 0.2 ? "2026-10-01" : TUE,
            dueTime: hasTime ? toHHMM(8 * 60 + Math.floor(rnd() * 14) * 60 + Math.floor(rnd() * 4) * 15) : undefined,
            estimateMin: [10, 15, 30, 45, 60, 120][Math.floor(rnd() * 6)],
            area: ["work", "admin", "family", "finance", undefined][Math.floor(rnd() * 5)],
            important: rnd() < 0.2,
          }),
        );
      }
      const events = rnd() < 0.5 ? [ev({ start: toHHMM(18 * 60 + Math.floor(rnd() * 8) * 15), end: "21:30" })] : [];
      const now = new Date(2026, 9, 6, Math.floor(rnd() * 20), Math.floor(rnd() * 4) * 15);
      const tl = buildTimeline(base(tasks, { events }), TUE, now);
      expectNoOverlap(tl.items);
      // nothing flexible lands in the past
      for (const it of tl.items) if (!it.fixed && !it.done && !it.muted && it.kind === "task") expect(it.start).toBeGreaterThanOrEqual(now.getHours() * 60 + now.getMinutes());
    }
  });
});

describe("overdue work comes first", () => {
  it("carried-over tasks are placed before today's own tasks and are marked", () => {
    const d = base([task({ title: "Today thing", due: TUE, estimateMin: 15, area: "family" }), task({ title: "Old thing", due: "2026-10-01", estimateMin: 15, area: "family" })]);
    const tl = buildTimeline(d, TUE, TUE_7);
    const old = title(tl.items, "Old thing")!;
    const now = title(tl.items, "Today thing")!;
    expect(old.carried).toBe(true);
    expect(now.carried).toBeUndefined();
    expect(old.start).toBeLessThan(now.start);
  });

  it("an overdue task that had a time loses it and is carried over", () => {
    const d = base([task({ title: "Missed", due: "2026-10-05", dueTime: "11:00", estimateMin: 15, area: "family" })]);
    const it = title(buildTimeline(d, TUE, TUE_7).items, "Missed");
    expect(it?.carried).toBe(true);
    expect(it?.fixed).toBe(false);
  });
});

describe("overflow moves to other days", () => {
  const crowded = (n: number) => base(Array.from({ length: n }, (_, i) => task({ title: `Errand ${i}`, due: TUE, estimateMin: 30, area: "home" })));

  it("what doesn't fit is reported", () => {
    expect(buildTimeline(crowded(8), TUE, TUE_7).overflow.length).toBeGreaterThan(0);
  });

  it("settling moves it to a day that has room, never today", () => {
    const d = crowded(8);
    const moves = settleOverflow(d, TUE_7);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.to > TUE).toBe(true);
    // after applying the moves nothing is left over today
    const by = new Map(moves.map((m) => [m.taskId, m.to]));
    const next = { ...d, tasks: d.tasks.map((t) => (by.has(t.id) ? { ...t, due: by.get(t.id) } : t)) };
    expect(buildTimeline(next, TUE, TUE_7).overflow).toHaveLength(0);
  });

  it("carried-over tasks stay put", () => {
    const d = base(Array.from({ length: 8 }, (_, i) => task({ title: `Old ${i}`, due: "2026-10-01", estimateMin: 30, area: "home" })));
    expect(settleOverflow(d, TUE_7)).toHaveLength(0);
  });
});

describe("Next up, night mode", () => {
  it("is what's happening now, else the next thing, else something earlier", () => {
    const d = base([task({ title: "Form", due: TUE, dueTime: "15:00", estimateMin: 30 })]);
    const at = (h: number, m: number) => buildTimeline(d, TUE, new Date(2026, 9, 6, h, m));
    expect(nextUp(at(15, 10), 15 * 60 + 10)?.title).toBe("Form");
    const early = nextUp(at(7, 0), 7 * 60);
    expect(early).not.toBeNull();
    expect(early!.start).toBeGreaterThanOrEqual(7 * 60);
    expect(nextUp(at(14, 0), 14 * 60)?.start).toBeGreaterThanOrEqual(14 * 60);
  });

  it("never offers a break or a commute", () => {
    const tl = buildTimeline(base(), MON, MON_7);
    for (let m = 0; m < 1440; m += 30) {
      const it = nextUp(tl, m);
      if (it) expect(["break", "commute"]).not.toContain(it.kind);
    }
  });

  it("night mode runs from 23:00 to the morning", () => {
    const p = { sleepStart: "23:00", wakeTime: "06:00" };
    expect(isNight(new Date(2026, 9, 6, 22, 59), p)).toBe(false);
    expect(isNight(new Date(2026, 9, 6, 23, 0), p)).toBe(true);
    expect(isNight(new Date(2026, 9, 7, 2, 0), p)).toBe(true);
    expect(isNight(new Date(2026, 9, 7, 6, 0), p)).toBe(false);
    expect(isNight(new Date(2026, 9, 7, 12, 0), p)).toBe(false);
    expect(isNight(new Date(2026, 9, 6, 22, 59), { sleepStart: "21:30", wakeTime: "06:00" })).toBe(true);
  });

  it("knows what tomorrow starts with", () => {
    const d = base([task({ title: "Pay rent", due: "2026-10-07", dueTime: "08:30", estimateMin: 10 })]);
    const f = firstThing(d, new Date(2026, 9, 6, 23, 30));
    expect(f.isTomorrow).toBe(true);
    expect(f.date).toBe("2026-10-07");
    expect(f.item).not.toBeNull();
  });

  it("after midnight it is still talking about the day ahead, today", () => {
    const f = firstThing(base(), new Date(2026, 9, 7, 1, 0));
    expect(f.isTomorrow).toBe(false);
    expect(f.date).toBe("2026-10-07");
  });
});

describe("typing a timed item through the parser", () => {
  it("'fill form at 3pm' becomes a timed task that lands at 15:00", () => {
    const p = parseCapture("fill form at 3pm", TUE_7);
    expect(p.dueTime).toBe("15:00");
    const d = base([task({ title: p.title, due: p.due, dueTime: p.dueTime, estimateMin: 20 })]);
    expect(toHHMM(title(buildTimeline(d, p.due!, TUE_7).items, p.title)!.start)).toBe("15:00");
  });
});
