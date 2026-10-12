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
  it("the morning brief is one line with today's must-dos, at 09:30, even on a work day", () => {
    const list = planNotifications(
      data([
        task({ title: "Pay rent", focus: true, due: "2026-10-06" }),
        task({ title: "Book dentist", due: "2026-10-06" }),
        task({ title: "Submit report", due: "2026-10-08" }),
      ]),
      NOW,
    );
    const morning = list.find((n) => n.key === "morning:2026-10-06")!;
    expect(morning.title).toBe("Good morning, Sahil");
    expect(morning.body).toMatch(/^Today: .*Pay rent/);
    expect(morning.body).toContain("Book dentist");
    expect(morning.body).not.toContain("Submit report");
    expect(hm(morning.at)).toBe("09:30");
    expect(morning.exact).toBe(false);
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

  it("end of day fires at the chosen time and says what is still open", () => {
    const list = planNotifications(data([task({ title: "A", due: "2026-10-06" })], { eveningWrap: "20:30" }), NOW);
    const wrap = list.find((n) => n.key === "wrap:2026-10-06")!;
    expect(hm(wrap.at)).toBe("20:30");
    expect(wrap.title).toBe("Tick or move what's left");
    expect(wrap.body).toContain("A");
    // Its tap opens a list (Done / Tomorrow / Not sure), so it carries no buttons that could tick everything at once.
    expect(wrap.actions).toBe(false);
    expect(wrap.ref).toBeUndefined();
    // With nothing open it is not sent at all.
    expect(planNotifications(data([], { rhythm: [] }), NOW).some((n) => n.key === "wrap:2026-10-06")).toBe(false);
  });

  it("reminder at the task's scheduled time, exact, with buttons", () => {
    const list = planNotifications(data([task({ title: "Call gran", due: "2026-10-06", dueTime: "19:45" })]), NOW);
    const r = list.find((n) => n.kind === "reminder")!;
    expect(hm(r.at)).toBe("19:45");
    expect(r.exact).toBe(true);
    expect(r.actions).toBe(true);
  });

  it("a time you set yourself is never moved: not by work hours, not by quiet hours", () => {
    const mid = planNotifications(data([task({ title: "Call gran", due: "2026-10-06", dueTime: "11:00" })]), NOW);
    expect(hm(mid.find((n) => n.kind === "reminder")!.at)).toBe("11:00");
    const late = planNotifications(data([task({ title: "Take medicine", due: "2026-10-06", dueTime: "23:55" })]), NOW);
    const r = late.find((n) => n.kind === "reminder")!;
    expect([iso(r.at), hm(r.at)]).toEqual(["2026-10-06", "23:55"]);
    const early = planNotifications(data([task({ title: "Gym", due: "2026-10-07", dueTime: "06:00" })]), NOW);
    expect(hm(early.find((n) => n.kind === "reminder")!.at)).toBe("06:00");
  });

  it("timed reminders are alarms with a loud channel, Done / Snooze, and follow-ups until you react", () => {
    const t = task({ id: "t1", title: "Take medicine", due: "2026-10-06", dueTime: "23:55" });
    const list = planNotifications(data([t]), NOW).filter((n) => n.taskId === "t1" && n.kind === "reminder");
    expect(list.map((n) => hm(n.at))).toEqual(["23:55", "00:00", "00:05", "00:10"]);
    expect(list.every((n) => n.alarm && n.exact && n.actions)).toBe(true);
    expect(list[1].title).toBe("Still waiting: Take medicine");
    // Seeing it (tapping, Done or Snooze) stops the follow-ups.
    const seen = planNotifications(data([{ ...t, alarmAck: at("2026-10-06", 23, 56).getTime() }]), NOW).filter((n) => n.taskId === "t1" && n.kind === "reminder");
    expect(seen).toHaveLength(1);
  });

  it("a snoozed alarm rings again at the snooze time, even in quiet hours, and drops the old follow-ups", () => {
    const snoozeAt = at("2026-10-06", 23, 40);
    const t = task({ id: "t2", title: "Take medicine", due: "2026-10-06", dueTime: "23:30", remindAt: snoozeAt.getTime(), alarmAck: at("2026-10-06", 23, 30).getTime() });
    const list = planNotifications(data([t]), at("2026-10-06", 23, 31)).filter((n) => n.taskId === "t2" && n.kind === "reminder");
    expect(list.map((n) => hm(n.at))).toEqual(["23:40", "23:45", "23:50", "23:55"]);
    expect(list[0].alarm).toBe(true);
  });

  it("everyday check-ins still wait for quiet hours to end", () => {
    const n = planNotifications(data([]), NOW).filter((x) => x.kind === "nudge" || x.kind === "wrap" || x.kind === "morning");
    for (const x of n) expect(["22:", "23:", "00:", "01:", "02:", "03:", "04:", "05:", "06:"].some((h) => hm(x.at).startsWith(h))).toBe(false);
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
      data([task({ due: "2026-10-06", dueTime: "20:00" })], { rhythm: [], quoteEvery: 0, notify: { morning: false, taskCheckIns: false, wrap: false, reminders: false, slots: false, events: false, bills: false, nudges: false, review: false, weekSoFar: false, quote: false, tonight: false, sessionNudges: false, dayDone: false } }),
      NOW,
    );
    expect(off).toHaveLength(0);
  });

  it("is sorted, stable and capped", () => {
    const many = Array.from({ length: 40 }, (_, i) => task({ title: `T${i}`, due: "2026-10-07", dueTime: `${10 + (i % 10)}:00`, area: "work" }));
    const list = planNotifications(data(many), NOW);
    expect(list.length).toBeLessThanOrEqual(320);
    expect(list.map((n) => n.at.getTime())).toEqual([...list.map((n) => n.at.getTime())].sort((a, b) => a - b));
    expect(hashId("morning:2026-10-06")).toBe(hashId("morning:2026-10-06"));
    expect(signature(list)).toBe(signature(planNotifications(data(many), NOW)));
  });
});

describe("sessions and daily rhythm", () => {
  // Your areas and rhythm seeded. Session nudges only exist for an area that is BEHIND its weekly target, which from
  // Wednesday on is true for everything (nothing done yet), so the examples use Wednesday.
  const WED = new Date(2026, 9, 7, 7, 0);
  const MON = new Date(2026, 9, 5, 7, 0);
  const EMAILS = { id: "emails", label: "Sort emails", time: "20:00", days: [0, 1, 2, 3, 4, 5, 6], enabled: true, kind: "chore" as const, message: "Have you sorted your email, {name}?" };
  const seeded = (over: Partial<AppData> = {}): AppData => {
    const s = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 }, ...over });
    // "Sort emails" is no longer a default (the evening check-in replaced it), but a tracked check-in still works like this one.
    return { ...s, profile: { ...s.profile!, rhythm: [...s.profile!.rhythm, EMAILS] } };
  };
  const all = { budget: Infinity };

  it("nudges when a session starts, with the counter in the title, but only for an area that is behind", () => {
    const list = planNotifications(seeded(), WED, all);
    const s = list.filter((n) => n.kind === "session");
    expect(s.length).toBeGreaterThan(5);
    const pbi = s.find((n) => n.title === "Power BI session 1")!;
    expect(pbi.ref).toMatch(/^session:powerbi:/);
    expect(pbi.actions).toBe(true);
    expect(hm(pbi.at)).toBe("18:00");
    // Monday morning nothing is behind yet: the sessions are in the list, but silent.
    expect(planNotifications(seeded(), MON, all).some((n) => n.kind === "session" && n.key.endsWith("2026-10-05"))).toBe(false);
    // On pace (two of three meditation sessions by Wednesday): silent.
    const sessions = [0, 1].map((i) => ({ id: "m" + i, areaId: "meditation", date: `2026-10-0${5 + i}`, minutes: 15, n: i + 1, at: 1, source: "manual" as const }));
    expect(planNotifications(seeded({ sessions }), WED, all).some((n) => n.kind === "session" && n.key.startsWith("session:meditation"))).toBe(false);
    // Switched off in Settings.
    const off = seeded();
    const quiet = { ...off, profile: { ...off.profile!, notify: { ...off.profile!.notify, sessionNudges: false } } };
    expect(planNotifications(quiet, WED, all).some((n) => n.kind === "session")).toBe(false);
  });

  it("asks 'Have you sorted your email, Sahil?' at 20:00 with buttons, until it's done (a tracked check-in)", () => {
    const list = planNotifications(seeded(), MON, all);
    const mail = list.find((n) => n.key === "rhythm:emails:2026-10-05")!;
    expect(mail.body).toBe("Have you sorted your email, Sahil?");
    expect(hm(mail.at)).toBe("20:00");
    expect(mail.actions).toBe(true);
    const done = planNotifications(seeded({ log: [{ key: "chore:emails:2026-10-05", status: "done", at: 1 }] }), MON, all);
    expect(done.some((n) => n.key === "rhythm:emails:2026-10-05")).toBe(false);
    expect(done.some((n) => n.key === "rhythm:emails:2026-10-06")).toBe(true);
  });

  it("the seeded defaults no longer have the separate 20:00 email ping: the evening check-in does it", () => {
    const s = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } });
    expect(s.profile!.rhythm.some((r) => r.id === "emails")).toBe(false);
    const list = planNotifications(s, MON, all);
    const tonight = list.find((n) => n.key === "tonight:2026-10-05")!;
    expect(hm(tonight.at)).toBe("20:00");
    expect(tonight.body).toMatch(/Anything from email to add\?$/);
    expect(tonight.title).toBe("Tonight");
    // A rhythm item you changed yourself is not removed.
    const mine = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 }, profile: { ...defaultProfile(), rhythm: [{ ...EMAILS, time: "21:15" }] } });
    expect(mine.profile!.rhythm.some((r) => r.id === "emails")).toBe(true);
  });

  it("a snoozed check-in comes back when you asked", () => {
    const until = new Date(2026, 9, 5, 20, 30).getTime();
    const list = planNotifications(seeded({ log: [{ key: "chore:emails:2026-10-05", status: "snooze", at: 1, until }] }), MON, all);
    expect(hm(list.find((n) => n.key === "rhythm:emails:2026-10-05")!.at)).toBe("20:30");
  });

  it("a skipped session is not reminded again", () => {
    const list = planNotifications(seeded({ log: [{ key: "session:walking:2026-10-07", status: "skip", at: 1 }] }), WED, all);
    expect(list.some((n) => n.key === "session:walking:2026-10-07")).toBe(false);
  });

  it("a finished session stops reminding", () => {
    const sessions = [{ id: "a", areaId: "powerbi", date: "2026-10-07", minutes: 60, n: 1, at: 1, source: "checkin" as const }];
    const list = planNotifications(seeded({ sessions }), WED, all);
    expect(list.some((n) => n.key === "session:powerbi:2026-10-07")).toBe(false);
  });

  it("midday nudge is weekdays only and has no buttons", () => {
    const list = planNotifications(seeded(), MON, all);
    const sat = list.find((n) => n.key === "rhythm:midday:2026-10-10");
    expect(sat).toBeUndefined();
    const mon = list.find((n) => n.key === "rhythm:midday:2026-10-05")!;
    expect([hm(mon.at), mon.actions]).toEqual(["13:00", false]);
  });

  it("22:00 is 'Tick or move what's left', only while something is open, and it names what", () => {
    const list = planNotifications(seeded(), MON, all);
    const wrap = list.find((n) => n.key === "wrap:2026-10-05")!;
    expect(hm(wrap.at)).toBe("22:00");
    expect(wrap.title).toBe("Tick or move what's left");
    // Monday is an office day: meditation, the walk, job prep and reading are what is planned.
    expect(wrap.body).toMatch(/Meditation|Walking|Job|English/);
    expect(wrap.actions).toBe(false);
    expect(wrap.ref).toBeUndefined();
  });

  it("the brief is silent when there is nothing to say, and names a focus when an area is behind", () => {
    // Monday morning: nothing due, nothing behind yet.
    expect(planNotifications(seeded(), MON, all).some((n) => n.key === "morning:2026-10-05")).toBe(false);
    // Wednesday: everything is behind, so the brief carries one focus.
    const m = planNotifications(seeded(), WED, all).find((n) => n.key === "morning:2026-10-08")!;
    expect(m.body).toMatch(/Focus: .* is behind/);
    // With a task due too, the must-do comes first.
    const withTask = planNotifications(seeded({ tasks: [task({ title: "Call the bank", due: "2026-10-08" })] }), WED, all).find((n) => n.key === "morning:2026-10-08")!;
    expect(withTask.body).toMatch(/^Today: Call the bank\. Focus: /);
  });
});
