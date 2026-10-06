import { describe, expect, it } from "vitest";
import { applyPolicy, hashId, planNotifications, signature } from "../lib/notifications/plan";
import { defaultProfile } from "../lib/profile";
import { seedIfNeeded } from "../lib/seed";
import type { AppData, Profile, Task } from "../lib/types";

// Tuesday 6 Oct 2026, 07:00. Work Mon-Fri 09:00-17:30, quiet 22:00-07:30.
const NOW = new Date(2026, 9, 6, 7, 0);
const at = (iso: string, hh: number, mm = 0) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const task = (over: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2),
  title: "Task",
  important: false,
  tags: [],
  steps: [],
  focus: false,
  status: "open",
  createdAt: 1,
  ...over,
});
const data = (tasks: Task[], profile: Partial<Profile> = {}): AppData => ({
  version: 1,
  tasks,
  settings: { firstRunAt: 1 },
  profile: { ...defaultProfile(), ...profile },
});

describe("quiet hours and work hours", () => {
  const p = defaultProfile();
  it("moves a late-night ping to the morning after quiet hours end", () => {
    expect(hm(applyPolicy(at("2026-10-06", 23, 15), false, p))).toBe("07:30");
    expect(iso(applyPolicy(at("2026-10-06", 23, 15), false, p))).toBe("2026-10-07");
  });
  it("small hours move to the same morning", () => {
    const d = applyPolicy(at("2026-10-07", 3, 0), false, p);
    expect([iso(d), hm(d)]).toEqual(["2026-10-07", "07:30"]);
  });
  it("holds a non-work ping mid-shift until the shift ends", () => {
    expect(hm(applyPolicy(at("2026-10-06", 11, 0), false, p))).toBe("17:30");
  });
  it("lets work tasks through mid-shift", () => {
    expect(hm(applyPolicy(at("2026-10-06", 11, 0), true, p))).toBe("11:00");
  });
  it("lets anything through on lunch break and on days off", () => {
    expect(hm(applyPolicy(at("2026-10-06", 13, 10), false, p))).toBe("13:10");
    expect(hm(applyPolicy(at("2026-10-10", 11, 0), false, p))).toBe("11:00"); // Saturday
  });
  it("work tasks still respect quiet hours", () => {
    expect(hm(applyPolicy(at("2026-10-06", 22, 30), true, p))).toBe("07:30");
  });
});

describe("planNotifications", () => {
  it("morning check-in lists today's focus things and what's due soon", () => {
    const list = planNotifications(
      data([
        task({ title: "Pay rent", focus: true, due: "2026-10-06" }),
        task({ title: "Book dentist", due: "2026-10-06" }),
        task({ title: "Submit report", due: "2026-10-08" }),
      ]),
      NOW,
    );
    const morning = list.find((n) => n.key === "morning:2026-10-06")!;
    expect(morning.title).toBe("2 things today");
    expect(morning.largeBody).toContain("• Pay rent");
    expect(morning.largeBody).toContain("Due soon: Submit report (Thursday)");
    expect(hm(morning.at)).toBe("08:00");
  });

  it("a task check-in asks 'Due Friday, where are you?' the day before, with buttons", () => {
    const list = planNotifications(data([task({ title: "Write essay", due: "2026-10-09" })]), at("2026-10-08", 7));
    const c = list.find((n) => n.kind === "checkin")!;
    expect(c.title).toBe("Due tomorrow, where are you?");
    expect(c.actions).toBe(true);
    expect(c.taskId).toBeDefined();
  });

  it("names the weekday when it's further out", () => {
    const list = planNotifications(data([task({ title: "Essay", due: "2026-10-09" })]), at("2026-10-08", 7));
    expect(list.some((n) => n.title === "Due tomorrow, where are you?")).toBe(true);
    const earlier = planNotifications(data([task({ title: "Essay", due: "2026-10-09" })]), NOW);
    // Two days before there's no check-in yet; it starts the day before.
    expect(earlier.some((n) => n.key === "checkin:" + earlier.find((x) => x.kind === "checkin")?.taskId + ":2026-10-08")).toBe(true);
  });

  it("evening wrap-up fires at the chosen time", () => {
    const list = planNotifications(data([task({ title: "A", due: "2026-10-06" })], { eveningWrap: "20:30" }), NOW);
    const wrap = list.find((n) => n.key === "wrap:2026-10-06")!;
    expect(hm(wrap.at)).toBe("20:30");
    expect(wrap.body).toContain("1 left");
  });

  it("reminder at the task's scheduled time, exact, with buttons", () => {
    const list = planNotifications(data([task({ title: "Call gran", due: "2026-10-06", dueTime: "19:45" })]), NOW);
    const r = list.find((n) => n.kind === "reminder")!;
    expect(hm(r.at)).toBe("19:45");
    expect(r.exact).toBe(true);
    expect(r.actions).toBe(true);
  });

  it("no pings mid-shift unless the task is Work", () => {
    const personal = planNotifications(data([task({ title: "Call gran", due: "2026-10-06", dueTime: "11:00" })]), NOW);
    expect(hm(personal.find((n) => n.kind === "reminder")!.at)).toBe("17:30");
    const work = planNotifications(data([task({ title: "Send deck", area: "work", due: "2026-10-06", dueTime: "11:00" })]), NOW);
    expect(hm(work.find((n) => n.kind === "reminder")!.at)).toBe("11:00");
  });

  it("each slot from 'Plan my day' gets a notification at its start", () => {
    const t = task({ title: "Study", slot: { date: "2026-10-06", start: "19:00", min: 45 } });
    const s = planNotifications(data([t]), NOW).find((n) => n.kind === "slot")!;
    expect(hm(s.at)).toBe("19:00");
    expect(s.title).toBe("Now: Study");
  });

  it("skips times already in the past, done tasks, and respects the toggles", () => {
    const list = planNotifications(
      data([task({ title: "Old", due: "2026-10-06", dueTime: "06:00" }), task({ title: "Done", status: "done", due: "2026-10-06", dueTime: "20:00" })]),
      NOW,
    );
    expect(list.some((n) => n.kind === "reminder")).toBe(false);
    const off = planNotifications(
      data([task({ due: "2026-10-06", dueTime: "20:00" })], { rhythm: [], notify: { morning: false, taskCheckIns: false, wrap: false, reminders: false, slots: false, events: false, bills: false, nudges: false, review: false } }),
      NOW,
    );
    expect(off).toHaveLength(0);
  });

  it("is sorted, stable and capped", () => {
    const many = Array.from({ length: 40 }, (_, i) => task({ title: `T${i}`, due: "2026-10-07", dueTime: `${10 + (i % 10)}:00`, area: "work" }));
    const list = planNotifications(data(many), NOW);
    expect(list.length).toBeLessThanOrEqual(120);
    expect(list.map((n) => n.at.getTime())).toEqual([...list.map((n) => n.at.getTime())].sort((a, b) => a - b));
    expect(hashId("morning:2026-10-06")).toBe(hashId("morning:2026-10-06"));
    expect(signature(list)).toBe(signature(planNotifications(data(many), NOW)));
  });
});

describe("sessions and daily rhythm", () => {
  // Tuesday 6 Oct 2026, 07:00, with your areas and rhythm seeded.
  const seeded = (over: Partial<AppData> = {}): AppData =>
    seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 }, ...over });
  const MON = new Date(2026, 9, 5, 7, 0);

  it("reminds you when each planned session starts, with the counter in the title", () => {
    const list = planNotifications(seeded(), MON);
    const s = list.filter((n) => n.kind === "session");
    expect(s.length).toBeGreaterThan(10);
    const pbi = s.find((n) => n.title === "Power BI session 1")!;
    expect(pbi.ref).toMatch(/^session:powerbi:/);
    expect(pbi.actions).toBe(true);
    expect(hm(pbi.at)).toBe("18:00");
  });

  it("asks 'Have you sorted your email, Sahil?' at 20:00 with buttons, until it's done", () => {
    const list = planNotifications(seeded(), MON);
    const mail = list.find((n) => n.key === "rhythm:emails:2026-10-05")!;
    expect(mail.body).toBe("Have you sorted your email, Sahil?");
    expect(hm(mail.at)).toBe("20:00");
    expect(mail.actions).toBe(true);
    const done = planNotifications(seeded({ log: [{ key: "chore:emails:2026-10-05", status: "done", at: 1 }] }), MON);
    expect(done.some((n) => n.key === "rhythm:emails:2026-10-05")).toBe(false);
    expect(done.some((n) => n.key === "rhythm:emails:2026-10-06")).toBe(true);
  });

  it("a snoozed check-in comes back when you asked", () => {
    const until = new Date(2026, 9, 5, 20, 30).getTime();
    const list = planNotifications(seeded({ log: [{ key: "chore:emails:2026-10-05", status: "snooze", at: 1, until }] }), MON);
    expect(hm(list.find((n) => n.key === "rhythm:emails:2026-10-05")!.at)).toBe("20:30");
  });

  it("a skipped session is not reminded again", () => {
    const list = planNotifications(seeded({ log: [{ key: "session:walking:2026-10-05", status: "skip", at: 1 }] }), MON);
    expect(list.some((n) => n.key === "session:walking:2026-10-05")).toBe(false);
  });

  it("a finished session stops reminding", () => {
    const sessions = [{ id: "a", areaId: "powerbi", date: "2026-10-05", minutes: 60, n: 1, at: 1, source: "checkin" as const }];
    const list = planNotifications(seeded({ sessions }), MON);
    expect(list.some((n) => n.key === "session:powerbi:2026-10-05")).toBe(false);
  });

  it("midday nudge is weekdays only and has no buttons", () => {
    const list = planNotifications(seeded(), MON);
    const sat = list.find((n) => n.key === "rhythm:midday:2026-10-10");
    expect(sat).toBeUndefined();
    const mon = list.find((n) => n.key === "rhythm:midday:2026-10-05")!;
    expect([hm(mon.at), mon.actions]).toEqual(["13:00", false]);
  });

  it("22:00 asks if you did today's sessions, listing what's still open", () => {
    const list = planNotifications(seeded(), MON);
    const wrap = list.find((n) => n.key === "wrap:2026-10-05")!;
    expect(hm(wrap.at)).toBe("22:00");
    expect(wrap.title).toBe("Did you do today's sessions?");
    expect(wrap.body).toContain("Power BI");
    expect(wrap.body).toContain("Walking");
    expect(wrap.ref).toBe("wrap:2026-10-05");
    expect(wrap.actions).toBe(true);
  });

  it("the morning ping becomes a briefing of the day's sessions", () => {
    const list = planNotifications(seeded(), MON);
    const m = list.find((n) => n.key === "morning:2026-10-05")!;
    expect(m.title).toBe("Good morning, Sahil");
    expect(m.largeBody).toContain("Power BI session 1");
  });
});
