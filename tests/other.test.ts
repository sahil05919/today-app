import { beforeEach, describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { intentOf, isCommandTitle } from "../lib/intentPhrases";
import { fmtMinutes, guessSub, otherLine, otherWeek } from "../lib/other";
import { weeklyPercent } from "../lib/progress";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import type { AppData, Task } from "../lib/types";
import { parseLogged, toWorkLog } from "../lib/workLog";

const NOW = new Date(2026, 9, 14, 15, 0); // Wed 14 Oct 2026
const WEEK = "2026-10-12";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `o${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const done = (o: Partial<Task>) => task({ status: "done", completedAt: new Date(2026, 9, 13, 10).getTime(), ...o });
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });

describe("8. Other work: what counts", () => {
  it("an own task that is done goes to Other; a session (or a task that stands for one, or one in a tracked area) does not", () => {
    const d = base({
      tasks: [
        done({ title: "Book dentist", estimateMin: 15 }),
        done({ title: "Practice DAX", area: "powerbi" }), // a tracked area's
        done({ title: "Power BI extra session", countsFor: "powerbi" }),
        done({ title: "Walking session 3", origin: { kind: "session", key: "session:walking:2026-10-12", date: "2026-10-12" } }),
        task({ title: "Still open" }),
      ],
    });
    const w = otherWeek(d, "2026-10-14");
    expect(w.entries.map((e) => e.title)).toEqual(["Book dentist"]);
    expect(w.minutes).toBe(15);
  });

  it("Gmail tasks, life admin / repeats, bills, ticked calendar events and logged time all count; sessions never do", () => {
    const d = base({
      tasks: [done({ title: "Reply to Pinnacle", notes: "From Gmail: Shift on 24 Oct", estimateMin: 20 })],
      series: [{ id: "s1", title: "Laundry", lifeId: "laundry", tags: [], important: false, steps: [], rule: { freq: "weekly", interval: 1, weekdays: [2] }, startDate: "2026-10-01", createdAt: 1, estimateMin: 30 }],
      occurrences: [{ key: "s1@2026-10-13", seriesId: "s1", date: "2026-10-13", status: "done", doneAt: new Date(2026, 9, 13, 20).getTime() }],
      events: [{ id: "e1", title: "Team workshop", date: "2026-10-14", start: "10:00", end: "11:30", createdAt: 1 }],
      eventMarks: { "e1@2026-10-14": { done: 1 } },
      worklog: [{ id: "w1", date: "2026-10-12", minutes: 120, title: "Building app", sub: "Building", at: 1 }],
      sessions: [{ id: "x", areaId: "powerbi", date: "2026-10-13", minutes: 60, n: 1, at: 1, source: "manual" }],
    });
    const w = otherWeek(d, "2026-10-14");
    expect(Object.fromEntries(w.entries.map((e) => [e.title, e.source]))).toEqual({ "Reply to Pinnacle": "gmail", Laundry: "life", "Team workshop": "event", "Building app": "logged" });
    expect(w.minutes).toBe(20 + 30 + 90 + 120);
  });

  it("sub-labels are guessed from the words and can be corrected", () => {
    expect(guessSub("Fix the website bug")).toBe("Building");
    expect(guessSub("Laundry")).toBe("Chores");
    expect(guessSub("Pay council tax")).toBe("Admin");
    expect(guessSub("Finish the SQL course")).toBe("Learning");
    expect(guessSub("Call Sam")).toBe("Other");
    actions.replaceAll(base({ tasks: [done({ id: "t-x", title: "Call Sam", estimateMin: 10 })] }));
    expect(otherWeek(getData(), WEEK).bySub.map((s) => s.sub)).toEqual(["Other"]);
    actions.setOtherLabel("task:t-x", "Admin");
    expect(otherWeek(getData(), WEEK).bySub.map((s) => s.sub)).toEqual(["Admin"]);
  });

  it("shows as one row: 'Other 6h 30m ✓'", () => {
    const d = base({ worklog: [{ id: "w1", date: "2026-10-13", minutes: 390, title: "Building app", sub: "Building", at: 1 }] });
    expect(otherLine(otherWeek(d, WEEK))).toBe("Other 6h 30m ✓ (+1h 30m extra 💪)");
    expect(otherLine(otherWeek(base({ worklog: [{ id: "w1", date: "2026-10-13", minutes: 120, title: "x", sub: "Other", at: 1 }] }), WEEK))).toBe("Other 2h of 5h");
    expect(fmtMinutes(150)).toBe("2h 30m");
  });
});

describe("8. logging time you already spent", () => {
  const p = (t: string) => parseLogged(t, NOW, base());

  it('"spent 2 hrs building the app" → 120 min, Building', () => {
    expect(p("spent 2 hrs building the app")).toMatchObject({ minutes: 120, title: "Building app", sub: "Building", date: "2026-10-14" });
  });

  it("the other phrasings", () => {
    expect(p("2h app build")).toMatchObject({ minutes: 120, title: "App build", sub: "Building" });
    expect(p("worked 45 min on CV")).toMatchObject({ minutes: 45, title: "CV", sub: "Other" });
    expect(p("did 1 hour cleaning")).toMatchObject({ minutes: 60, title: "Cleaning", sub: "Chores" });
    expect(p("spent 1.5 hours on forms")).toMatchObject({ minutes: 90, sub: "Admin" });
    expect(p("spent 1h30 reading")).toMatchObject({ minutes: 90, sub: "Learning" });
    expect(p("worked half an hour on the website")).toMatchObject({ minutes: 30, sub: "Building" });
  });

  it("Hinglish, and yesterday", () => {
    expect(p("aaj 2 ghante app pe kaam kiya")).toMatchObject({ minutes: 120, sub: "Building", date: "2026-10-14" });
    expect(p("kal 1 ghanta safai kiya")).toMatchObject({ minutes: 60, sub: "Chores", date: "2026-10-13" });
    expect(p("yesterday spent 90 min on forms")).toMatchObject({ minutes: 90, sub: "Admin", date: "2026-10-13" });
  });

  it("is not a log when it is a plan, a time of day, or has no duration", () => {
    for (const t of ["buy milk", "call mum at 6pm for 30 min", "2 pm dentist", "30 min walk tomorrow", "did the dishes", "reply to Sam tonight 2 hours", "remind me in 30 min"]) expect(p(t), t).toBeNull();
  });

  it("naming a tracked area makes it a session of that area, never Other", () => {
    expect(p("spent 1 hour on power bi")).toMatchObject({ minutes: 60, areaId: "powerbi" });
    expect(p("did 30 min walking")).toMatchObject({ areaId: "walking" });
  });

  it("it is an action, never a to-do: the intent detector sees it, and a stray one is cleaned away", () => {
    expect(intentOf("spent 2 hrs building the app")).toBe("log");
    expect(intentOf("aaj 2 ghante app pe kaam kiya")).toBe("log");
    expect(isCommandTitle("2h app build")).toBe(true);
    expect(intentOf("buy milk")).toBeNull();
  });

  describe("saved at once as done, with Undo", () => {
    beforeEach(() => actions.replaceAll(base()));

    it("shows under Other, moves the percentage, and Undo takes it away exactly", () => {
      const before = weeklyPercent(getData(), "2026-10-14");
      const w = actions.addWorkLog(toWorkLog(p("spent 2 hrs building the app")!, NOW));
      expect(getData().tasks).toHaveLength(0); // never a to-do
      const week = otherWeek(getData(), "2026-10-14");
      expect(week.bySub).toEqual([expect.objectContaining({ sub: "Building", minutes: 120 })]);
      const after = weeklyPercent(getData(), "2026-10-14");
      expect(after.pct).toBeGreaterThan(before.pct);
      expect(after.done - before.done).toBe(120);
      expect((getData().history ?? []).some((e) => e.kind === "done" && e.title === "Building app")).toBe(true);
      actions.removeWorkLog(w.id);
      expect(otherWeek(getData(), "2026-10-14").minutes).toBe(0);
      expect(weeklyPercent(getData(), "2026-10-14")).toEqual(before);
      expect((getData().history ?? []).some((e) => e.kind === "reopened" && e.title === "Building app")).toBe(true);
    });
  });
});

describe("8. the percentage, in minutes, with caps and a bonus", () => {
  it("each area is capped at its own target; Other at its hours; the extra is a bonus and never lifts the % over 100", () => {
    const sessions = [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, areaId: "powerbi", date: `2026-10-${11 + i}`, minutes: 60, n: i, at: i, source: "manual" as const }));
    const d = base({ sessions, worklog: [{ id: "w1", date: "2026-10-13", minutes: 480, title: "Building app", sub: "Building", at: 1 }] });
    const p = weeklyPercent(d, "2026-10-14");
    // Power BI: 5 sessions of 60 against 4 × 60 → 240 counted, 60 extra. Other: 480 against 300 → 300 counted, 180 extra.
    expect(p).toMatchObject({ done: 240 + 300, bonus: 60 + 180, target: 1135 });
    expect(p.pct).toBe(Math.round((540 / 1135) * 100));
    // Everything met many times over is still exactly 100%.
    const all = base({
      sessions: [
        ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, areaId: "powerbi", date: "2026-10-12", minutes: 60, n: i, at: i, source: "manual" as const })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, areaId: "meditation", date: "2026-10-12", minutes: 15, n: i, at: i, source: "manual" as const })),
        ...Array.from({ length: 7 }, (_, i) => ({ id: `j${i}`, areaId: "job", date: "2026-10-12", minutes: 40, n: i, at: i, source: "manual" as const })),
        ...Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, areaId: "english", date: "2026-10-12", minutes: 20, n: i, at: i, source: "manual" as const })),
        ...Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, areaId: "walking", date: "2026-10-12", minutes: 35, n: i, at: i, source: "manual" as const })),
      ],
      worklog: [{ id: "w1", date: "2026-10-13", minutes: 600, title: "Building app", sub: "Building" as const, at: 1 }],
    });
    const full = weeklyPercent(all, "2026-10-14");
    expect(full.pct).toBe(100);
    expect(full.bonus).toBeGreaterThan(0);
  });

  it("with no Other target the tracked areas decide alone", () => {
    const off = base();
    off.profile = { ...off.profile!, otherHours: 0 };
    expect(weeklyPercent(off, "2026-10-14").target).toBe(835);
  });
});
