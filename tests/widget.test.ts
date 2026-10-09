import { describe, expect, it } from "vitest";
import { addDays } from "../lib/dates";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import { buildWidgetSnapshot, snapshotSignature } from "../lib/widget";
import { applyWidgetAction, applyWidgetActions } from "../lib/widgetRun";
import { resolveTap } from "../lib/tap";
import type { AppData, Task } from "../lib/types";

// Tue 6 Oct 2026, 06:30
const NOW = new Date(2026, 9, 6, 6, 30);
const TODAY = "2026-10-06";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `w${++n}`, title: `Task ${n}`, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (tasks: Task[] = []): AppData => ({ ...seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW), tasks });

describe("the widget snapshot", () => {
  it("lists what is still open today in time order, with times, and whether Start / Done make sense", () => {
    const d: AppData = {
      ...base([task({ title: "Reply to Sam", due: TODAY })]),
      events: [{ id: "e1", title: "Dinner", date: TODAY, start: "19:00", end: "21:00", createdAt: 1 }],
    };
    const s = buildWidgetSnapshot(d, NOW);
    expect(s.v).toBe(1);
    expect(s.date).toBe(TODAY);
    expect(s.name).toBe("Sahil");
    expect(s.items.length).toBeGreaterThan(2);
    // In order; nothing muted (breaks, commute) and nothing done.
    expect(s.items.map((i) => i.start)).toEqual([...s.items.map((i) => i.start)].sort((a, b) => a - b));
    expect(s.items.some((i) => i.kind === "break" || i.kind === "commute")).toBe(false);
    const dinner = s.items.find((i) => i.title === "Dinner")!;
    expect(dinner).toMatchObject({ kind: "event", act: false, start: 19 * 60, end: 21 * 60 });
    const t = s.items.find((i) => i.title === "Reply to Sam")!;
    expect(t).toMatchObject({ kind: "task", act: true });
    expect(t.taskId).toBeTruthy();
    const session = s.items.find((i) => i.kind === "session")!;
    expect(session.act).toBe(true);
    expect(session.ref).toMatch(/^session:[a-z]+:2026-10-06$/);
    expect(typeof s.pct).toBe("number");
    expect(s.pace).toMatch(/On track|Slightly behind/);
  });

  it("drops what is done, and knows the first thing tomorrow for when today is finished", () => {
    const t = task({ title: "Pay card", due: TODAY });
    const d = base([t]);
    const open = buildWidgetSnapshot(d, NOW);
    const done = buildWidgetSnapshot({ ...d, tasks: [{ ...t, status: "done", completedAt: NOW.getTime() }] }, NOW);
    expect(open.items.some((i) => i.title === "Pay card")).toBe(true);
    expect(done.items.some((i) => i.title === "Pay card")).toBe(false);
    expect(open.tomorrow).toBeTruthy();
    expect(open.tomorrow!.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("is compact and only changes when what it shows changes", () => {
    const d = base();
    const a = snapshotSignature(buildWidgetSnapshot(d, NOW));
    expect(a.length).toBeLessThan(8000);
    expect(snapshotSignature(buildWidgetSnapshot(d, NOW))).toBe(a);
    const later = snapshotSignature(buildWidgetSnapshot({ ...d, tasks: [task({ due: TODAY, title: "New thing" })] }, NOW));
    expect(later).not.toBe(a);
  });

  it("carries no notes text", () => {
    const d = base([task({ title: "Visible title", notes: "PRIVATE NOTE", due: TODAY })]);
    expect(snapshotSignature(buildWidgetSnapshot(d, NOW))).not.toContain("PRIVATE");
  });
});

describe("Done tapped on the widget is applied through the normal actions", () => {
  it("completes a task and counts a session, and is a no-op the second time", () => {
    actions.replaceAll(base([task({ id: "wt", title: "Widget task", due: TODAY })]));
    const snap = buildWidgetSnapshot(getData(), NOW);
    const t = snap.items.find((i) => i.taskId === "wt")!;
    expect(applyWidgetAction({ type: "done", kind: "task", key: t.key, taskId: "wt", date: TODAY, at: 1 })).toBe(true);
    expect(getData().tasks.find((x) => x.id === "wt")!.status).toBe("done");
    expect(applyWidgetAction({ type: "done", kind: "task", key: t.key, taskId: "wt", date: TODAY, at: 2 })).toBe(false);

    const s = snap.items.find((i) => i.kind === "session")!;
    const before = getData().sessions?.length ?? 0;
    expect(applyWidgetActions([{ type: "done", kind: "session", key: s.key, ref: s.ref, date: TODAY, at: 3 }])).toBe(1);
    expect(getData().sessions?.length).toBe(before + 1);
    // Done twice never counts twice.
    applyWidgetActions([{ type: "done", kind: "session", key: s.key, ref: s.ref, date: TODAY, at: 4 }]);
    expect(getData().sessions?.length).toBe(before + 1);
  });

  it("a running timer on that item stops with it", () => {
    actions.replaceAll(base());
    const snap = buildWidgetSnapshot(getData(), NOW);
    const s = snap.items.find((i) => i.kind === "session")!;
    actions.startItemTimer(s.ref!, s.title, 15);
    expect(getData().settings.timer?.ref).toBe(s.ref);
    applyWidgetAction({ type: "done", kind: "session", key: s.key, ref: s.ref, date: TODAY, at: 1 });
    expect(getData().settings.timer).toBeUndefined();
  });
});

describe("Start from the widget lands on the same item as a notification tap", () => {
  it("a session / chore / task identity from the snapshot resolves to the real item", () => {
    const d = base([task({ id: "wk", title: "Start me", due: TODAY })]);
    const snap = buildWidgetSnapshot(d, NOW);
    const s = snap.items.find((i) => i.kind === "session")!;
    const r = resolveTap(d, { kind: "session", key: s.key, ref: s.ref }, TODAY, NOW);
    expect(r.k).toBe("item");
    if (r.k === "item") expect(r.it.sessionKey).toBe(s.ref);
    expect(resolveTap(d, { kind: "slot", taskId: "wk" }, TODAY, NOW)).toEqual({ k: "task", taskId: "wk" });
    // Tomorrow's timeline is untouched by any of this.
    expect(buildTimeline(d, addDays(TODAY, 1), new Date(2026, 9, 7)).date).toBe("2026-10-07");
  });
});
