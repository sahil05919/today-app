import { describe, expect, it } from "vitest";
import { addDays, toISO } from "../lib/dates";
import { catchUpPlan, firstDayWithRoom, overdueTasks, pendingForReview, pileUp } from "../lib/pileup";
import { seedIfNeeded } from "../lib/seed";
import { actions, DO_NOW_MIN, getData, MAX_SNOOZES } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import type { AppData, Task } from "../lib/types";

// Wed 7 Oct 2026, 09:30. Mon 5 / Tue 6 are behind us.
const NOW = new Date(2026, 9, 7, 9, 30);
const TODAY = "2026-10-07";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `p${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (tasks: Task[] = []): AppData => ({ ...seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, NOW), tasks });

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

describe("snoozing is limited to twice; the third time you choose", () => {
  const today = toISO(new Date());
  const add = (title: string) => actions.addTask({ title, due: today, important: false, tags: [] });
  const find = (id: string) => getData().tasks.find((t) => t.id === id)!;

  it("snoozes twice, then asks you to decide", () => {
    const t = add("Pay council tax");
    // Early in the day so "an hour" is still today.
    const morning = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 8, 0);
    expect(actions.snoozeTask(t.id, "hour", morning)).toBe("snoozed");
    expect(actions.snoozeTask(t.id, "hour", morning)).toBe("snoozed");
    expect(find(t.id).snoozeCount).toBe(MAX_SNOOZES);
    expect(actions.snoozeTask(t.id, "hour", morning)).toBe("decide");
  });

  it("do it now starts a 15 minute timer and clears the count", () => {
    const t = add("Book dentist");
    actions.update(t.id, { snoozeCount: 2 });
    actions.decideTask(t.id, "now");
    expect(getData().settings.timer).toMatchObject({ taskId: t.id, goalMin: DO_NOW_MIN });
    expect(find(t.id).snoozeCount).toBe(0);
    actions.discardTimer();
  });

  it("a fixed slot books an exact time", () => {
    const t = add("Call landlord");
    actions.update(t.id, { snoozeCount: 2 });
    actions.decideTask(t.id, "slot", { date: "2026-12-01", time: "18:30" });
    expect(find(t.id)).toMatchObject({ due: "2026-12-01", dueTime: "18:30", snoozeCount: 0 });
  });

  it("drop removes it", () => {
    const t = add("Sort old photos");
    actions.decideTask(t.id, "drop");
    expect(getData().tasks.some((x) => x.id === t.id)).toBe(false);
  });

  it("a snooze to tomorrow moves the day; late in the day 'an hour' rolls to tomorrow", () => {
    const t = add("Water the plants");
    actions.snoozeTask(t.id, "tomorrow");
    expect(find(t.id).due).toBe(addDays(today, 1));
    const u = add("Email Priya");
    const late = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 30);
    actions.snoozeTask(u.id, "hour", late);
    expect(find(u.id).due).toBe(addDays(today, 1));
  });

  it("sessions and chores have their own count per day", () => {
    expect(actions.snoozeItem("session:powerbi", Date.now(), today)).toBe("snoozed");
    expect(actions.snoozeItem("session:powerbi", Date.now(), today)).toBe("snoozed");
    expect(actions.snoozeItem("session:powerbi", Date.now(), today)).toBe("decide");
    // a different day starts fresh
    expect(actions.snoozeItem("session:powerbi", Date.now(), addDays(today, 1))).toBe("snoozed");
    actions.clearSnoozes("session:powerbi", addDays(today, 1));
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
