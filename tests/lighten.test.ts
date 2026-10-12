import { describe, expect, it } from "vitest";
import { completeTaskIn } from "../lib/done";
import { isLightenIntent } from "../lib/intentPhrases";
import { applyPull, calmCard, dayDoneState, freeMinutesToday, lighterLine, minutesText, pullCandidates, preTicked } from "../lib/lighten";
import { plannedForDay } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { weekProgress } from "../lib/sessions";
import { buildTimeline } from "../lib/timeline";
import { toISO } from "../lib/dates";
import { pulledLine, weekStats, yourWeekText } from "../lib/weekly";
import { addLog } from "../lib/sessions";
import type { AppData, SessionLog, Task } from "../lib/types";

// Tue 13 Oct 2026, 17:30. The week is Mon 12 … Sun 18.
const NOW = new Date(2026, 9, 13, 17, 30);
const TODAY = "2026-10-13";
const base = (over: Partial<AppData> = {}): AppData => {
  const s = seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW);
  // No bills or rhythm chores here: the day's list is just the week's sessions and the tasks below.
  return { ...s, bills: [], profile: { ...s.profile!, rhythm: [] }, ...over };
};
const task = (o: Partial<Task>): Task => ({ id: `t${Math.random().toString(36).slice(2)}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: NOW.getTime() - 86_400_000, estimateMin: 30, ...o });

/** Everything planned today, done. */
function allDoneToday(d: AppData, at = NOW, except: string[] = []): AppData {
  const day = toISO(at);
  let out = d;
  for (const s of plannedForDay(d, day).filter((x) => !x.done && !except.includes(x.areaId))) out = addLog(out, s.areaId, day, "manual", at)!.data;
  return out;
}

describe("4. typed phrases that are commands, never tasks", () => {
  it.each(["work done", "today's work done", "Todays work done", "done for today", "I'm free", "im free", "pull work", "give me more", "lighten my week", "aaj ka kaam ho gaya", "aur kaam do", "free hoon", "Can you take out some work from future and adjust in", "I am free now"])("%s", (t) => {
    expect(isLightenIntent(t)).toBe(true);
  });
  it.each(["work on power bi", "call work about the rota", "free parking permit", "Done: grocery", "pull request review", "I did power bi", "give me a call tomorrow"])("%s is an ordinary task", (t) => {
    expect(isLightenIntent(t)).toBe(false);
  });
});

describe("4. all done for today", () => {
  it("is not offered while something is still open", () => {
    const d = base({ tasks: [task({ title: "Call the bank", due: TODAY })] });
    expect(dayDoneState(d, NOW).done).toBe(false);
  });

  it("is offered when today's list is finished and 30+ minutes remain before ~22:30", () => {
    const d = allDoneToday(base());
    const s = dayDoneState(d, NOW);
    expect(s.done).toBe(true);
    expect(s.free).toBeGreaterThanOrEqual(30);
    expect(s.offer).toBe(true);
  });

  it("is not offered late in the evening (under 30 minutes left), and not when nothing was done at all", () => {
    expect(dayDoneState(allDoneToday(base()), new Date(2026, 9, 13, 22, 10)).offer).toBe(false);
    expect(dayDoneState(base({ sessions: [] }), new Date(2026, 9, 13, 22, 0)).done).toBe(false);
  });

  it("a fixed-time thing later today does not hold it back", () => {
    const d = allDoneToday(base({ tasks: [task({ title: "Dinner call", due: TODAY, dueTime: "21:00" })] }));
    expect(dayDoneState(d, NOW).done).toBe(true);
  });

  it("free minutes count what is not booked", () => {
    const d = allDoneToday(base({ events: [{ id: "e", title: "Dinner", date: TODAY, start: "19:00", end: "21:00", createdAt: 1 }] }));
    const open = freeMinutesToday(allDoneToday(base()), NOW);
    expect(freeMinutesToday(d, NOW)).toBeLessThan(open);
    expect(minutesText(80)).toBe("1h 20m");
    expect(minutesText(45)).toBe("45m");
  });

  it("the calm card celebrates what was done", () => {
    const d = allDoneToday(base());
    const c = calmCard(d, NOW);
    expect(c.title).toBe("Calm evening ahead 🙌");
    expect(c.line).toMatch(/^You did .+ today\./);
    expect(c.suggestion.length).toBeGreaterThan(10);
  });
});

describe("4. Lighten my week", () => {
  const sunday = (n: number) => `2026-10-${12 + n}`;

  it("ranks Waiting-for-room first, then areas behind, then important, then the busiest day", () => {
    const crowded = Array.from({ length: 6 }, (_, i) => task({ title: `Big ${i}`, due: "2026-10-14", estimateMin: 90 }));
    const d = allDoneToday(base({ tasks: [...crowded, task({ title: "Renew passport", due: "2026-10-16", important: true })] }));
    const c = pullCandidates(d, NOW);
    expect(c.length).toBeGreaterThan(3);
    const rank = { waiting: 0, behind: 1, important: 2, busiest: 3 } as const;
    expect(c.map((x) => rank[x.reason])).toEqual([...c.map((x) => rank[x.reason])].sort((a, b) => a - b));
    expect(c.some((x) => x.reason === "waiting")).toBe(true);
    expect(c.find((x) => x.title === "Renew passport")?.reason).toBe("important");
  });

  it("never offers anything booked at a time, or a session of an area already done today", () => {
    const d = allDoneToday(base({ tasks: [task({ title: "Dentist", due: "2026-10-15", dueTime: "10:00", important: true })] }));
    const c = pullCandidates(d, NOW);
    expect(c.some((x) => x.title === "Dentist")).toBe(false);
    const doneAreas = new Set((d.sessions ?? []).filter((l) => l.date === TODAY).map((l) => l.areaId));
    expect(c.some((x) => x.item && x.areaId && doneAreas.has(x.areaId))).toBe(false);
  });

  it("only raids this week's sessions (never next week's plan)", () => {
    const d = allDoneToday(base());
    for (const c of pullCandidates(d, new Date(2026, 9, 17, 17, 30)).filter((x) => x.item)) expect(c.from <= "2026-10-18").toBe(true);
  });

  it("a pulled task MOVES to today (it is not copied), and no snooze is counted", () => {
    const t = task({ title: "Renew passport", due: "2026-10-16", important: true });
    const d = allDoneToday(base({ tasks: [t] }));
    const pick = pullCandidates(d, NOW).find((x) => x.taskId === t.id)!;
    const r = applyPull(d, [pick], NOW);
    expect(r.data.tasks.filter((x) => x.title === "Renew passport")).toHaveLength(1);
    expect(r.data.tasks.find((x) => x.id === t.id)).toMatchObject({ due: TODAY });
    expect(r.data.tasks.find((x) => x.id === t.id)!.snoozeCount ?? 0).toBe(0);
    expect(r.byDay).toEqual({ "2026-10-16": 1 });
    expect(lighterLine(r.byDay, TODAY)).toBe("Fri is now 1 item lighter.");
    expect(r.events[0]).toMatchObject({ kind: "pulled", date: "2026-10-16", to: { date: TODAY } });
  });

  it("a pulled session keeps its number and its place in the weekly count, and leaves the day it was on", () => {
    // Thursday evening: by now several areas are behind their weekly pace, and Friday and the weekend still hold sessions.
    const THU = new Date(2026, 9, 15, 17, 30);
    // (Power BI is the one thing not done today, so it is still behind and its Friday session can come forward.)
    const d0 = allDoneToday(base(), THU, ["powerbi"]);
    const pick = pullCandidates(d0, THU).find((x) => x.item && x.reason === "behind")!;
    expect(pick).toBeTruthy();
    const area = pick.areaId!;
    const before = weekProgress(d0, "2026-10-15").find((r) => r.area.id === area)!.done;
    const r = applyPull(d0, [pick], THU);
    // The future day no longer has it…
    expect(plannedForDay(r.data, pick.from).some((s) => s.areaId === area && !s.done)).toBe(false);
    // …it is a task today that counts for the area…
    const t = r.data.tasks.find((x) => x.countsFor === area && x.origin?.kind === "session")!;
    expect(t).toMatchObject({ due: "2026-10-15", generated: true });
    // …and finishing it counts as the next session of the area, once.
    const done = completeTaskIn(r.data, t.id, THU)!.data;
    expect(weekProgress(done, "2026-10-15").find((x) => x.area.id === area)!.done).toBe(before + 1);
    const logs = (done.sessions ?? []).filter((l: SessionLog) => l.areaId === area);
    expect(new Set(logs.map((l) => l.n)).size).toBe(logs.length);
  });

  it("what is pre-ticked fits the free time, and fits the evening without overflowing", () => {
    const d = allDoneToday(base({ tasks: [task({ title: "A", due: "2026-10-15", important: true, estimateMin: 45 }), task({ title: "B", due: "2026-10-15", important: true, estimateMin: 45 }), task({ title: "C", due: "2026-10-16", important: true, estimateMin: 120 })] }));
    const free = freeMinutesToday(d, NOW);
    const c = pullCandidates(d, NOW);
    const ticked = preTicked(d, NOW, c, free);
    expect(c.filter((x) => ticked.has(x.key)).reduce((n, x) => n + x.minutes, 0)).toBeLessThanOrEqual(free);
    const moved = applyPull(d, c.filter((x) => ticked.has(x.key)), NOW).data;
    expect(buildTimeline(moved, TODAY, NOW).overflow.filter((o) => ticked.has(o.task.id))).toEqual([]);
  });

  it("the weekly review mentions it", () => {
    const d = allDoneToday(base({ tasks: [task({ title: "Renew passport", due: "2026-10-16", important: true })] }));
    const pick = pullCandidates(d, NOW).find((x) => x.title === "Renew passport")!;
    const r = applyPull(d, [pick], NOW);
    const withHistory: AppData = { ...r.data, history: [...(d.history ?? []), ...r.events] };
    const s = weekStats(withHistory, "2026-10-12", TODAY);
    expect(s.pulled).toBe(1);
    expect(pulledLine(3)).toBe("You pulled 3 things forward this week 💪");
    const text = yourWeekText(s, weekStats(withHistory, "2026-10-05", TODAY), "Sahil");
    expect(text.lines.join(" ")).toContain("You pulled 1 thing forward this week 💪");
    void sunday;
  });
});
