import { describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { addDays } from "../lib/dates";
import { seedIfNeeded } from "../lib/seed";
import { bestStreaks, biggestWeek, dayShare, jarBetween, monthCompare, slowDay, tasksDone, winLine } from "../lib/winjar";
import type { AppData, HistoryEvent, SessionLog, Task } from "../lib/types";

const NOW = new Date(2026, 9, 14, 19, 0); // Wed 14 Oct 2026, 19:00
const TODAY = "2026-10-14";
let n = 0;
const session = (areaId: string, date: string): SessionLog => ({ id: `s${++n}`, areaId, date, minutes: 30, n, at: new Date(`${date}T19:00:00`).getTime(), source: "manual" });
const hist = (key: string, date: string, extra: Partial<HistoryEvent> = {}): HistoryEvent => ({ id: `h${++n}`, at: new Date(`${date}T15:00:00`).getTime(), date, kind: "done", type: "task", key, title: key, createdByMe: true, ...extra });
const task = (o: Partial<Task>): Task => ({ id: `t${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });
const days = (k: number, from = -1) => Array.from({ length: k }, (_, i) => addDays(TODAY, from - i));

/** 14 Power BI sessions, 9 walks, 3 English, plus 20 own tasks, 1 Gmail task, 1 life-admin and 2 pulled forward, all in the last 30 days. */
function busyMonth(): AppData {
  const sessions = [...days(14).map((d) => session("powerbi", d)), ...days(9).map((d) => session("walking", d)), ...days(3).map((d) => session("english", d))];
  const gmail = task({ id: "g1", title: "Reply to Pinnacle", status: "done", notes: "From Gmail: Shift" });
  const history: HistoryEvent[] = [
    ...days(20).map((d, i) => hist(`task:own${i}`, d)),
    hist("task:g1", days(1)[0]),
    hist("occ:laundry-series@2026-10-10", "2026-10-10"),
    hist("pull:1", "2026-10-12", { kind: "pulled" }),
    hist("pull:2", "2026-10-13", { kind: "pulled" }),
    // sessions are in the history too, but are counted from the session logs
    ...sessions.slice(0, 3).map((s) => hist(`session:${s.areaId}:${s.date}`, s.date, { type: "session" })),
  ];
  return base({
    sessions,
    tasks: [gmail],
    series: [{ id: "laundry-series", title: "Laundry", lifeId: "laundry", tags: [], important: false, steps: [], rule: { freq: "weekly", interval: 1 }, startDate: "2026-09-01", createdAt: 1 }],
    history,
  });
}

describe("6. win jar: the numbers", () => {
  const d = busyMonth();
  const s = jarBetween(d, addDays(TODAY, -29), TODAY);

  it("match what was recorded: sessions per area, own / Gmail / life-admin tasks, pulled forward", () => {
    expect(s.sessions).toEqual({ powerbi: 14, walking: 9, english: 3 });
    expect(s.ownTasks).toBe(20);
    expect(s.gmailTasks).toBe(1);
    expect(s.lifeAdmin).toBe(1);
    expect(tasksDone(s)).toBe(22);
    expect(s.pulled).toBe(2);
  });

  it("an undone tick does not count", () => {
    const undone = { ...d, history: [...d.history!, hist("task:own0", days(20)[0], { kind: "reopened", at: new Date(`${days(20)[0]}T16:00:00`).getTime() })] };
    expect(jarBetween(undone, addDays(TODAY, -29), TODAY).ownTasks).toBe(19);
  });

  it("the card line is the three strongest numbers", () => {
    expect(winLine(d, TODAY)).toBe("Last 30 days: 22 tasks done, 14 Power BI sessions, 9 walks. You're moving 💪");
    expect(winLine(base(), TODAY)).toBeNull();
    expect(winLine(base({ sessions: [session("walking", days(1)[0])] }), TODAY)).toBe("Last 30 days: 1 walk. You're moving 💪");
  });

  it("this month against last month; sessions older than the history still count", () => {
    const old = base({ sessions: [session("powerbi", "2026-09-05"), session("powerbi", "2026-09-06"), session("powerbi", "2026-10-02")] });
    const m = monthCompare(old, TODAY);
    expect(m.thisLabel).toBe("October");
    expect(m.lastLabel).toBe("September");
    expect(m.thisMonth.sessions).toEqual({ powerbi: 1 });
    expect(m.lastMonth.sessions).toEqual({ powerbi: 2 });
  });

  it("best streaks and the biggest week", () => {
    const sessions = [...["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((x) => session("powerbi", x)), ...["2026-10-08", "2026-10-09"].map((x) => session("powerbi", x)), session("walking", "2026-10-02")];
    const st = bestStreaks(base({ sessions }), TODAY);
    expect(st.overall).toBe(4);
    expect(st.byArea.powerbi).toBe(4);
    expect(st.byArea.walking).toBe(1);
    // Week of 28 Sep has Thu–Sun (4 sessions + 1 walk): the biggest.
    expect(biggestWeek(base({ sessions }), TODAY)).toMatchObject({ week: "2026-09-28", sessions: 5 });
    expect(biggestWeek(base(), TODAY)).toBeNull();
  });
});

describe("6. the slow-day card", () => {
  const d = busyMonth();

  it("after 18:00 with less than half of today done", () => {
    expect(slowDay(d, new Date(2026, 9, 14, 19, 0), { done: 1, total: 4 })).toEqual({ reason: "evening" });
    expect(slowDay(d, new Date(2026, 9, 14, 19, 0), { done: 2, total: 4 })).toBeNull(); // exactly half is not "less than half"
    expect(slowDay(d, new Date(2026, 9, 14, 17, 59), { done: 0, total: 4 })).toBeNull(); // too early in the day
    expect(slowDay(d, new Date(2026, 9, 14, 19, 0), { done: 0, total: 0 })).toBeNull(); // nothing planned
  });

  it("when yesterday was under 50%", () => {
    const yesterday = addDays(TODAY, -1);
    // Something to cheer with (sessions from last week), but yesterday's plan and tasks were mostly left.
    const older = base({ sessions: [session("powerbi", addDays(TODAY, -6)), session("walking", addDays(TODAY, -5))] });
    const slow = { ...older, tasks: [task({ title: "A", due: yesterday }), task({ title: "B", due: yesterday }), task({ title: "C", due: yesterday, status: "done" })] };
    expect(dayShare(slow, yesterday)).toBeLessThan(0.5);
    expect(slowDay(slow, new Date(2026, 9, 14, 9, 0), { done: 0, total: 3 })).toEqual({ reason: "yesterday" });
    // Yesterday everything planned was done: no card.
    const fine = { ...older, sessions: [...(older.sessions ?? []), ...["powerbi", "walking", "job", "english", "meditation"].map((id) => session(id, yesterday))] };
    expect(dayShare(fine, yesterday)).toBeGreaterThanOrEqual(0.5);
    expect(slowDay(fine, new Date(2026, 9, 14, 9, 0), { done: 0, total: 3 })).toBeNull();
  });

  it("when I used an off day or skipped a session today", () => {
    expect(slowDay({ ...d, offDays: [TODAY] }, new Date(2026, 9, 14, 9, 0), { done: 0, total: 3 })).toEqual({ reason: "rest" });
    const skipped = { ...d, log: [{ key: `session:powerbi:${TODAY}`, status: "skip" as const, at: NOW.getTime() }] };
    expect(slowDay(skipped, new Date(2026, 9, 14, 9, 0), { done: 0, total: 3 })).toEqual({ reason: "rest" });
  });

  it("at most once a day: dismissed means gone until tomorrow; and never with nothing to cheer", () => {
    const dismissed = { ...d, settings: { ...d.settings, winJarDismissed: TODAY } };
    expect(slowDay(dismissed, new Date(2026, 9, 14, 19, 0), { done: 0, total: 4 })).toBeNull();
    expect(slowDay(dismissed, new Date(2026, 9, 15, 19, 0), { done: 0, total: 4 })).toEqual({ reason: "evening" });
    expect(slowDay(base(), new Date(2026, 9, 14, 19, 0), { done: 0, total: 4 })).toBeNull();
  });
});
