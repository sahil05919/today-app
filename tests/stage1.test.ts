import { describe, expect, it } from "vitest";
import { addDays, toISO } from "../lib/dates";
import { planNotifications } from "../lib/notifications/plan";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import { findTimelineItem, resolveTap } from "../lib/tap";
import { AUTO_STOP_MIN, extendedGoal, STILL_GOING_MIN, timerEndsAt, timerGoal, timerPhase } from "../lib/timer";
import { applyTimerAction, completeTimer } from "../lib/timerRun";
import { buildTimeline } from "../lib/timeline";
import { upcomingDays } from "../lib/upcoming";
import type { AppData, Task } from "../lib/types";

// Wed 7 Oct 2026, 09:30
const NOW = new Date(2026, 9, 7, 9, 30);
const TODAY = "2026-10-07";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `s1-${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (tasks: Task[] = []): AppData => ({ ...seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, NOW), tasks });
const tlOf = (d: AppData, i: number) => {
  const day = addDays(TODAY, i);
  return { day, tl: buildTimeline(d, day, i === 0 ? NOW : new Date(`${day}T00:00:00`)) };
};

/** First session item in the next week, wherever the planner put it. */
function someSession(d: AppData) {
  for (let i = 0; i < 7; i++) {
    const { day, tl } = tlOf(d, i);
    const it = tl.items.find((x) => x.kind === "session" && !x.done);
    if (it) return { it, day };
  }
  throw new Error("no session planned");
}

describe("notification tap → exact card", () => {
  it("a session notification finds that session's timeline item", () => {
    const d = base();
    const { it, day } = someSession(d);
    const r = resolveTap(d, { kind: "session", key: `session:${it.areaId}:${day}`, ref: it.sessionKey }, TODAY, NOW);
    expect(r.k).toBe("item");
    if (r.k === "item") {
      expect(r.it.key).toBe(it.key);
      expect(r.date).toBe(day);
    }
  });

  it("works from the key alone when there is no ref", () => {
    const d = base();
    const { it, day } = someSession(d);
    expect(findTimelineItem(d, `session:${it.areaId}:${day}`, TODAY, NOW)?.it.areaId).toBe(it.areaId);
  });

  it("a chore notification finds the chore", () => {
    const d = base();
    for (let i = 0; i < 7; i++) {
      const { day, tl } = tlOf(d, i);
      const c = tl.items.find((x) => x.kind === "chore" && !x.done);
      if (c) {
        const r = resolveTap(d, { kind: "chore", key: `rhythm:${c.choreId}:${day}`, ref: `chore:${c.choreId}:${day}` }, TODAY, NOW);
        expect(r.k).toBe("item");
        return;
      }
    }
  });

  it("a bill notification finds the bill, even when its reminder fires days before it is due", () => {
    const d = base();
    for (let i = 0; i < 8; i++) {
      const b = tlOf(d, i).tl.items.find((x) => x.kind === "bill" && !x.done && x.bill);
      if (b?.bill) {
        const r = resolveTap(d, { kind: "bill", key: `bill:${b.bill.id}:${b.bill.due}:${b.bill.offset}`, ref: b.bill.key }, TODAY, NOW);
        expect(r.k).toBe("item");
        return;
      }
    }
  });

  it("a session that is already done says so instead of opening nothing", () => {
    const d = base();
    const { it, day } = someSession(d);
    const done: AppData = { ...d, sessions: [{ id: "x", areaId: it.areaId!, date: day, minutes: 20, n: 1, at: 1, source: "manual" }] };
    const r = resolveTap(done, { kind: "session", ref: it.sessionKey }, TODAY, NOW);
    expect(r).toMatchObject({ k: "gone", message: "Already done 👍" });
  });

  it("an event notification opens its event; a deleted one is gone", () => {
    const d: AppData = { ...base(), events: [{ id: "e1", title: "Dinner", date: "2026-10-08", start: "18:00", createdAt: 1 }] };
    expect(resolveTap(d, { kind: "event", key: "event:e1" }, TODAY, NOW)).toMatchObject({ k: "event" });
    expect(resolveTap(d, { kind: "event", key: "event:nope" }, TODAY, NOW).k).toBe("gone");
  });

  it("task taps: open task, finished task is gone, check-ins open the check-in", () => {
    const t = task({ due: TODAY });
    const d = base([t, task({ id: "fin", status: "done" })]);
    expect(resolveTap(d, { kind: "slot", taskId: t.id }, TODAY, NOW)).toEqual({ k: "task", taskId: t.id });
    expect(resolveTap(d, { kind: "checkin", taskId: t.id }, TODAY, NOW)).toEqual({ k: "checkin", taskId: t.id });
    expect(resolveTap(d, { kind: "reminder", taskId: "fin" }, TODAY, NOW).k).toBe("gone");
  });

  it("the simple kinds go to their panels", () => {
    const d = base();
    expect(resolveTap(d, { kind: "wrap" }, TODAY, NOW)).toEqual({ k: "panel", panel: "evening" });
    expect(resolveTap(d, { kind: "review" }, TODAY, NOW)).toEqual({ k: "panel", panel: "review" });
    expect(resolveTap(d, { kind: "nudge" }, TODAY, NOW)).toEqual({ k: "panel", panel: "progress" });
    expect(resolveTap(d, { kind: "morning" }, TODAY, NOW)).toEqual({ k: "panel", panel: "feeling" });
    expect(resolveTap(d, { kind: "quote" }, TODAY, NOW)).toEqual({ k: "panel", panel: "quote" });
  });
});

describe("timers stop at the planned time", () => {
  it("a session's goal is its area's planned minutes", () => {
    const d = base();
    const { it } = someSession(d);
    const area = d.profile!.areas.find((a) => a.id === it.areaId)!;
    expect(timerGoal(d, it)).toBe(area.target!.minutes);
  });

  it("Meditation gets 15 minutes", () => {
    const d = base();
    const med = d.profile!.areas.find((a) => /meditation/i.test(a.name));
    expect(med?.target?.minutes).toBe(15);
    expect(timerGoal(d, { kind: "session", areaId: med!.id, start: 600, end: 660 })).toBe(15);
  });

  it("a task uses its estimate; without one there is no goal", () => {
    const withEst = task({ estimateMin: 25 });
    const without = task({});
    const d = base([withEst, without]);
    expect(timerGoal(d, { kind: "task", taskId: withEst.id, start: 0, end: 60 })).toBe(25);
    expect(timerGoal(d, { kind: "task", taskId: without.id, start: 0, end: 60 })).toBeUndefined();
  });

  it("a chore or bill uses the minutes the timeline gave it", () => {
    const d = base();
    expect(timerGoal(d, { kind: "chore", start: 600, end: 620 })).toBe(20);
    expect(timerGoal(d, { kind: "bill", start: 600, end: 610 })).toBe(10);
  });

  it("counts down, finishes at zero, and counts up when there is no goal", () => {
    const t = { startedAt: 1_000_000, goalMin: 15 };
    expect(timerPhase(t, t.startedAt + 2 * 60_000)).toMatchObject({ phase: "running", leftMs: 13 * 60_000 });
    expect(timerPhase(t, t.startedAt + 15 * 60_000).phase).toBe("finished");
    expect(timerEndsAt(t)).toBe(t.startedAt + 15 * 60_000);
    const open = { startedAt: 1_000_000 };
    expect(timerPhase(open, open.startedAt + 10 * 60_000).phase).toBe("running");
    expect(timerPhase(open, open.startedAt + STILL_GOING_MIN * 60_000).phase).toBe("still-going");
    expect(timerPhase(open, open.startedAt + AUTO_STOP_MIN * 60_000).phase).toBe("auto-stop");
    expect(timerEndsAt(open)).toBeNull();
  });

  it("+5 min adds to the goal, and from now if the time is already up", () => {
    const t = { startedAt: 0, goalMin: 15 };
    expect(extendedGoal(t, 10 * 60_000)).toBe(20);
    expect(extendedGoal(t, 18 * 60_000)).toBe(23);
  });

  it("starting a task timer without a goal uses its estimate; extend and done work on the stored timer", () => {
    const t = task({ estimateMin: 30 });
    actions.restore(t);
    actions.startTimer(t.id);
    expect(getData().settings.timer?.goalMin).toBe(30);
    expect(applyTimerAction("extend")).toBe(true);
    expect(getData().settings.timer!.goalMin).toBe(35);
    expect(applyTimerAction("done")).toBe(true);
    expect(getData().settings.timer).toBeUndefined();
    expect(getData().tasks.find((x) => x.id === t.id)?.status).toBe("done");
    expect(completeTimer()).toBe(false);
    actions.remove(t.id);
  });

  it("the alarm is planned for startedAt + goal and disappears when the timer stops early", () => {
    const startedAt = NOW.getTime();
    const d = base();
    const running: AppData = { ...d, settings: { ...d.settings, timer: { ref: `session:meditation:${TODAY}`, label: "Meditation session 8", startedAt, goalMin: 15 } } };
    const alarm = planNotifications(running, NOW).find((x) => x.kind === "timer");
    expect(alarm).toBeTruthy();
    expect(alarm!.at.getTime()).toBe(startedAt + 15 * 60_000);
    expect(alarm!.alarm).toBe(true);
    expect(alarm!.title).toMatch(/Meditation session 8/);
    // Stopped early: the timer is gone, so is the alarm (rescheduleAll cancels and re-plans from the data).
    const stopped: AppData = { ...running, settings: { ...running.settings, timer: undefined } };
    expect(planNotifications(stopped, NOW).some((x) => x.kind === "timer")).toBe(false);
    // Extended: the alarm moves.
    const longer: AppData = { ...running, settings: { ...running.settings, timer: { ...running.settings.timer!, goalMin: 20 } } };
    expect(planNotifications(longer, NOW).find((x) => x.kind === "timer")!.at.getTime()).toBe(startedAt + 20 * 60_000);
  });

  it("a timer with no goal schedules no alarm", () => {
    const d = base();
    const running: AppData = { ...d, settings: { ...d.settings, timer: { ref: `chore:x:${TODAY}`, label: "x", startedAt: NOW.getTime() } } };
    expect(planNotifications(running, NOW).some((x) => x.kind === "timer")).toBe(false);
  });
});

describe("next 3 days", () => {
  it("lists tomorrow, the day after and day 3, fixed things first with their times", () => {
    const d: AppData = { ...base(), events: [{ id: "e2", title: "Dinner", date: toISO(new Date(2026, 9, 8)), start: "18:00", end: "20:00", createdAt: 1 }] };
    const days = upcomingDays(d, TODAY);
    expect(days.map((x) => x.label.slice(0, 3))).toEqual(["Tom", "Day", "Sat"]);
    expect(days[0].date).toBe("2026-10-08");
    expect(days[0].top[0]).toMatchObject({ title: "Dinner", time: "18:00", fixed: true });
    expect(days[0].count).toBeGreaterThan(0);
    expect(days.every((x) => x.top.length <= 3)).toBe(true);
  });
});
