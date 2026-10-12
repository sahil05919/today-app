import { describe, expect, it } from "vitest";
import { addDays, toISO } from "../lib/dates";
import { catchUpPlan, firstDayWithRoom, overdueTasks, pendingForReview, pileUp } from "../lib/pileup";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import type { AppData, Task } from "../lib/types";

// Wed 7 Oct 2026, 09:30. Mon 5 / Tue 6 are behind us.
const NOW = new Date(2026, 9, 7, 9, 30);
const TODAY = "2026-10-07";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `p${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (tasks: Task[] = []): AppData => ({ ...withoutLife(seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, NOW)), tasks });
/** These tests are not about life admin: the seeded pack is taken out so it cannot take up room in their days. */
const withoutLife = (d: AppData): AppData => ({ ...d, series: (d.series ?? []).filter((s) => !s.lifeId) });


describe("pending work must not pile up", () => {
  it("three or more overdue items = piling up, said plainly", () => {
    const d = base([task({ due: "2026-10-01" }), task({ due: "2026-10-02" }), task({ due: "2026-10-03" })]);
    const p = pileUp(d, TODAY);
    expect(p.piling).toBe(true);
    expect(p.message).toMatch(/piling up/);
    expect(p.message).toMatch(/3 things are overdue/);
  });

  it("being behind on targets also counts, even with nothing overdue", () => {
    // Wednesday with no sessions done yet is behind pace.
    const p = pileUp(base(), TODAY);
    expect(p.behind.length).toBeGreaterThan(0);
    expect(p.piling).toBe(true);
  });

  it("a calm start of the week is not piling up", () => {
    expect(pileUp(base([task({ due: "2026-10-05" })]), "2026-10-05").piling).toBe(false);
  });

  it("a task parked by Adjust my day isn't counted as overdue", () => {
    const d = base([task({ due: "2026-10-01", hideUntil: "2026-10-08" })]);
    expect(overdueTasks(d, TODAY)).toHaveLength(0);
  });

  it("the catch-up plan gives every overdue task a day with room, and nothing overlaps there", () => {
    const d = base(Array.from({ length: 6 }, (_, i) => task({ title: `Late ${i}`, due: addDays("2026-10-06", -i), estimateMin: 30, area: "home" })));
    const plan = catchUpPlan(d, NOW);
    expect(plan.moves.length + plan.stuck.length).toBe(6);
    const by = new Map(plan.moves.map((m) => [m.taskId, m.to]));
    const next: AppData = { ...d, tasks: d.tasks.map((t) => (by.has(t.id) ? { ...t, due: by.get(t.id), dueTime: undefined } : t)) };
    for (const m of plan.moves) {
      const tl = buildTimeline(next, m.to, m.to === TODAY ? NOW : new Date(m.to + "T00:00:00"));
      expect(tl.overflow.some((o) => o.task.id === m.taskId), `${m.title} should fit on ${m.to}`).toBe(false);
    }
  });

  it("finds the first day with room for a task in the Sunday review", () => {
    const d = base([task({ id: "x", title: "Big", due: "2026-10-04", estimateMin: 30, area: "home" })]);
    const day = firstDayWithRoom(d, d.tasks[0], "2026-10-12");
    expect(day >= "2026-10-12").toBe(true);
  });

  it("the Sunday review lists everything still open from today or earlier", () => {
    const d = base([task({ due: "2026-10-04" }), task({ due: "2026-10-11" }), task({ due: "2026-10-12" }), task({ due: "2026-10-03", status: "done" })]);
    expect(pendingForReview(d, "2026-10-11")).toHaveLength(2);
  });
});

describe("Reschedule replaces Snooze", () => {
  const today = toISO(new Date());
  const add = (title: string) => actions.addTask({ title, due: today, important: false, tags: [] });
  const find = (id: string) => getData().tasks.find((t) => t.id === id)!;
  const at = (h: number, m = 0) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), h, m);

  it("+1 hour gives it a time an hour from now, and Undo puts it back", () => {
    const t = add("Pay council tax");
    const r = actions.reschedule({ kind: "task", taskId: t.id }, { kind: "hour" }, at(8, 0))!;
    expect(find(t.id)).toMatchObject({ due: today, dueTime: "09:00" });
    expect(r.message).toBe("Moved to today 09:00");
    r.undo();
    expect(find(t.id).dueTime).toBeUndefined();
  });

  it("late in the day '+1 hour' rolls to tomorrow morning", () => {
    const u = add("Email Priya");
    actions.reschedule({ kind: "task", taskId: u.id }, { kind: "hour" }, at(23, 30));
    expect(find(u.id).due).toBe(addDays(today, 1));
  });

  it("moving tasks around by the app doesn't count as a snooze", () => {
    const t = add("Renew passport photo");
    actions.moveTasks([{ taskId: t.id, to: addDays(today, 3) }]);
    expect(find(t.id).snoozeCount ?? 0).toBe(0);
  });

  it("adding a task with only a suggested time doesn't turn it into a timed alarm", () => {
    const t = actions.addTask({ title: "Reply to Sam", due: today, dueTime: "20:00", timeSource: "suggested", important: false, tags: [] });
    expect(find(t.id).dueTime).toBeUndefined();
    const typed = actions.addTask({ title: "Call Sam", due: today, dueTime: "20:00", timeSource: "typed", important: false, tags: [] });
    expect(find(typed.id).dueTime).toBe("20:00");
  });
});
