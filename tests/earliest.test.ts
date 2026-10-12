import { describe, expect, it } from "vitest";
import { addDays } from "../lib/dates";
import { planNotifications } from "../lib/notifications/plan";
import { toMin } from "../lib/profile";
import { planWeek } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { buildTimeline } from "../lib/timeline";
import type { AppData, Task } from "../lib/types";

// Mon 12 Oct 2026, 06:30: the whole week is still ahead.
const NOW = new Date(2026, 9, 12, 6, 30);
const MON = "2026-10-12";
const week = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW), ...extra });
const task = (o: Partial<Task>): Task => ({ id: `e${Math.random()}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, ...o });

describe("1. no auto-planning before 11:00", () => {
  it("the default is 11:00", () => {
    expect(base().profile!.earliestAuto).toBe("11:00");
  });

  it("re-planning a normal week: no auto-placed session starts before 11:00, on any day, and Meditation still gets its 3", () => {
    const { sessions, short } = planWeek(base(), NOW);
    expect(sessions.length).toBeGreaterThan(20);
    for (const s of sessions) expect(s.start, `${s.date} ${s.title}`).toBeGreaterThanOrEqual(11 * 60);
    expect(sessions.filter((s) => s.areaId === "meditation")).toHaveLength(3);
    expect(short).toEqual([]);
  });

  it("the timeline places flexible tasks and bills from 11:00 at the earliest (weekend too)", () => {
    const d = base({ tasks: [task({ title: "Reply to Sam", due: "2026-10-17", estimateMin: 15, area: "family" }), task({ title: "Sort cupboard", due: "2026-10-14", estimateMin: 20, area: "home" })] });
    for (const day of week) {
      const tl = buildTimeline(d, day, new Date(`${day}T06:00:00`), { today: MON });
      for (const it of tl.items) if (!it.fixed && !it.allDay && !it.done) expect(it.start, `${day} ${it.title}`).toBeGreaterThanOrEqual(11 * 60);
    }
    const sat = buildTimeline(d, "2026-10-17", new Date("2026-10-17T06:00:00"), { today: MON });
    expect(sat.items.find((x) => x.title === "Reply to Sam")!.start).toBeGreaterThanOrEqual(11 * 60);
  });

  it("what you timed yourself stays exactly where you put it (a 09:00 dentist, a 07:00 shift, a phone-calendar event)", () => {
    const d = base({
      tasks: [task({ title: "Dentist", due: "2026-10-14", dueTime: "09:00", estimateMin: 30 })],
      events: [{ id: "shift", title: "Pinnacle shift", date: "2026-10-15", start: "07:00", end: "15:00", createdAt: 1 }],
      calendarEvents: [{ id: "cal:1:2026-10-16", calId: "1", title: "Breakfast with Sam", date: "2026-10-16", start: "08:30", end: "09:30", createdAt: 1, source: "calendar" }],
    });
    const at = (day: string, title: string) => buildTimeline(d, day, new Date(`${day}T06:00:00`), { today: MON }).items.find((x) => x.title === title)!;
    expect(at("2026-10-14", "Dentist").start).toBe(9 * 60);
    expect(at("2026-10-15", "Pinnacle shift").start).toBe(7 * 60);
    expect(at("2026-10-16", "Breakfast with Sam").start).toBe(8 * 60 + 30);
  });

  it("the setting works: with 08:00 the old morning slot is used again", () => {
    const d = base();
    const early = { ...d, profile: { ...d.profile!, earliestAuto: "08:00" } };
    expect(planWeek(early, NOW).sessions.some((s) => s.start < 11 * 60)).toBe(true);
  });

  it("no default check-in, nudge or session ping before 11:00; the 09:30 brief stays; a time you set yourself stays", () => {
    const d = base({ tasks: [task({ title: "Call the bank", due: "2026-10-14", dueTime: "08:30" })] });
    const plan = planNotifications(d, NOW);
    for (const n of plan) {
      const m = n.at.getHours() * 60 + n.at.getMinutes();
      if (["checkin", "nudge", "slot", "session", "chore", "bill", "life"].includes(n.kind)) expect(m, `${n.kind} ${n.key}`).toBeGreaterThanOrEqual(toMin("11:00"));
    }
    // The morning brief is only for a day the app has not been opened, and is silent when there is nothing to say; if it exists it is 09:30.
    for (const n of plan.filter((x) => x.kind === "morning")) expect(`${n.at.getHours()}:${n.at.getMinutes()}`).toBe("9:30");
    // The reminder for the task YOU timed at 08:30 is untouched.
    expect(plan.some((n) => n.kind === "reminder" && n.at.getHours() === 8 && n.at.getMinutes() === 30)).toBe(true);
  });
});
