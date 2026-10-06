import { describe, expect, it } from "vitest";
import { billReminders, dueDates } from "../lib/bills";
import { computeNudges } from "../lib/nudges";
import { planNotifications } from "../lib/notifications/plan";
import { parseCapture } from "../lib/parse";
import { defaultProfile, toHHMM } from "../lib/profile";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { weekProgress } from "../lib/sessions";
import type { AppData, FixedEvent } from "../lib/types";

// Tuesday 6 Oct 2026, 07:00. Week: Mon 5 … Sun 11.
const TUE = new Date(2026, 9, 6, 7, 0);
const MON = new Date(2026, 9, 5, 7, 0);
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const seeded = (over: Partial<AppData> = {}, today = MON): AppData =>
  seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 }, ...over }, today);
const ev = (over: Partial<FixedEvent>): FixedEvent => ({ id: "e", title: "Dinner", date: "2026-10-07", createdAt: 1, ...over });
const count = (plan: ReturnType<typeof planSessions>, area: string) => plan.filter((s) => s.areaId === area && !s.done).length;

describe("typing 'event …'", () => {
  it("makes a fixed block with a date and time", () => {
    const p = parseCapture("event Wednesday 6pm dinner", TUE);
    expect(p).toMatchObject({ kind: "event", title: "Dinner", due: "2026-10-07" });
    expect(p.event?.start).toBe("18:00");
  });
  it("understands a time range and Hinglish", () => {
    const r = parseCapture("event friday 6pm to 8pm movie", TUE);
    expect([r.event?.start, r.event?.end, r.due]).toEqual(["18:00", "20:00", "2026-10-09"]);
    const h = parseCapture("event shanivar shaam 6 baje dinner", TUE);
    expect([h.kind, h.due, h.event?.start]).toEqual(["event", "2026-10-10", "18:00"]);
  });
  it("uses ~2h as the length", () => {
    expect(parseCapture("event thursday 7pm gym ~2h", TUE).event?.end).toBe("21:00");
  });
  it("no time means the whole day, and an outing counts as the walk", () => {
    const p = parseCapture("event saturday outing at the park", seeded().profile ? TUE : TUE, seeded().profile);
    expect(p.event?.start).toBeUndefined();
    expect(p.event?.countsFor).toBe("walking");
  });
  it("plain text is still a task", () => {
    expect(parseCapture("events of the week review", TUE).kind).toBeUndefined();
  });
});

describe("typing 'groceries: …'", () => {
  it("makes list items and nothing else", () => {
    const p = parseCapture("groceries: milk, sugar and rice", TUE);
    expect(p.kind).toBe("grocery");
    expect(p.groceryItems).toEqual(["Milk", "Sugar", "Rice"]);
  });
});

describe("events reshuffle the week", () => {
  const base = planSessions(seeded(), MON);

  it("sessions that no longer fit move to other days, and spread out", () => {
    const d = seeded({ events: [ev({ start: "17:30", end: "23:00" })] });
    const plan = planSessions(d, MON);
    // Nothing lands on the event.
    expect(plan.filter((s) => s.date === "2026-10-07" && s.end > 17.5 * 60)).toHaveLength(0);
    // Power BI still gets its 4, on different days.
    expect(count(plan, "powerbi")).toBe(4);
    expect(new Set(plan.filter((s) => s.areaId === "powerbi").map((s) => s.date)).size).toBe(4);
    // Nothing piles onto one day: no day has more sessions than a normal busy weekday.
    const perDay = new Map<string, number>();
    for (const s of plan) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(Math.max(...[...new Set(base.map((s) => s.date))].map((dd) => base.filter((s) => s.date === dd).length)));
  });

  it("a full-day weekend event clears that day, and weekends stay light", () => {
    const d = seeded({ events: [ev({ date: "2026-10-10", title: "Trip" })] });
    const plan = planSessions(d, MON);
    expect(plan.filter((s) => s.date === "2026-10-10")).toHaveLength(0);
    expect(count(plan, "walking")).toBe(6); // moved to Sunday and the weekdays
    expect(plan.filter((s) => s.date === "2026-10-11").reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(100);
  });

  it("when a target can't be met, it says so instead of cramming", () => {
    // Job only happens on weekday nights; losing Wednesday night leaves 4 of 5.
    const d = seeded({ events: [ev({ start: "20:00", end: "22:30" })] });
    const plan = planSessions(d, MON);
    expect(count(plan, "job")).toBe(4);
    // Mid-week it's flagged; on a Monday it's too early to worry.
    expect(computeNudges(d, MON).some((n) => n.id === "behind:job")).toBe(false);
    expect(computeNudges(d, new Date(2026, 9, 8, 7, 0)).some((n) => n.id === "behind:job")).toBe(true);
  });

  it("an outing counts as the walk: none planned that day, and it counts once the day comes", () => {
    const d = seeded({ events: [ev({ date: "2026-10-10", title: "Park outing", countsFor: "walking" })] });
    expect(planSessions(d, MON).filter((s) => s.areaId === "walking" && s.date === "2026-10-10")).toHaveLength(0);
    expect(count(planSessions(d, MON), "walking")).toBe(5);
    expect(weekProgress(d, "2026-10-10").find((r) => r.area.id === "walking")!.done).toBe(1);
    expect(weekProgress(d, "2026-10-09").find((r) => r.area.id === "walking")!.done).toBe(0);
  });

  it("reminds you before an event", () => {
    const list = planNotifications(seeded({ events: [ev({ start: "18:00", end: "20:00" })] }), MON);
    const n = list.find((x) => x.key === "event:e")!;
    expect(hm(n.at)).toBe("17:00");
    expect(n.title).toBe("Dinner");
  });
});

describe("bills and chores", () => {
  const d = seeded({}, MON);
  const bill = (id: string) => d.bills!.find((b) => b.id === id)!;

  it("rent: remind to withdraw cash 3 days before the 1st (28th, or the 29th in a 31-day month)", () => {
    const sep = billReminders(d, "2026-09-20", "2026-10-02").filter((r) => r.bill.id === "rent");
    expect(sep.map((r) => r.date)).toEqual(["2026-09-28"]); // September has 30 days
    const oct = billReminders(d, "2026-10-20", "2026-11-02").filter((r) => r.bill.id === "rent");
    expect(oct.map((r) => r.date)).toEqual(["2026-10-29"]); // October has 31 days
    expect(oct[0].due).toBe("2026-11-01");
  });

  it("credit card: every 15th, with a heads-up two days before", () => {
    const r = billReminders(d, "2026-10-01", "2026-10-31").filter((x) => x.bill.id === "credit-card");
    expect(r.map((x) => x.date)).toEqual(["2026-10-13", "2026-10-15"]);
  });

  it("mobile is on autopay: no reminders at all", () => {
    expect(billReminders(d, "2026-10-01", "2026-12-31").some((r) => r.bill.id === "mobile")).toBe(false);
  });

  it("clean room: every 3 days from the last time it was done", () => {
    expect(dueDates(bill("clean-room"), "2026-10-05", "2026-10-20")).toEqual(["2026-10-05"]);
    const done = { ...bill("clean-room"), lastDone: "2026-10-05" };
    expect(dueDates(done, "2026-10-06", "2026-10-20")).toEqual(["2026-10-08"]);
    // Overdue things are due today, they don't pile up.
    expect(dueDates({ ...done, lastDone: "2026-09-20" }, "2026-10-06", "2026-10-20")).toEqual(["2026-10-06"]);
  });

  it("an overdue chore is due today, not on every other day you look at", () => {
    // Clean room has been due since Monday 5 Oct. Looking at Friday must not show it; looking at today must.
    const onFriday = billReminders(d, "2026-10-09", "2026-10-09", "2026-10-06").filter((r) => r.bill.id === "clean-room");
    expect(onFriday).toHaveLength(0);
    const today = billReminders(d, "2026-10-06", "2026-10-06", "2026-10-06").filter((r) => r.bill.id === "clean-room");
    expect(today.map((r) => r.date)).toEqual(["2026-10-06"]);
  });

  it("weekend admin: grocery run on Saturday, finance review on Sunday", () => {
    const all = billReminders(d, "2026-10-05", "2026-10-11");
    expect(all.filter((r) => r.bill.id === "grocery").map((r) => r.date)).toEqual(["2026-10-10"]);
    expect(all.filter((r) => r.bill.id === "finance-review").map((r) => r.date)).toEqual(["2026-10-11"]);
  });

  it("the rent notification arrives on the 29th with Done / Snooze / Skip", () => {
    const list = planNotifications(d, new Date(2026, 9, 27, 7, 0));
    const n = list.find((x) => x.key === "bill:rent:2026-11-01:3")!;
    expect(hm(n.at)).toBe("18:00");
    expect(n.at.getDate()).toBe(29);
    expect(n.actions).toBe(true);
    expect(n.ref).toBe("bill:rent:2026-11-01");
    expect(n.body).toContain("withdraw cash");
  });

  it("a paid bill stops reminding", () => {
    const paid = { ...d, log: [{ key: "bill:rent:2026-11-01", status: "done" as const, at: 1 }] };
    expect(billReminders(paid, "2026-10-20", "2026-11-02").some((r) => r.bill.id === "rent")).toBe(false);
  });
});

describe("shopping list", () => {
  it("the Saturday reminder lists what's on your list, and nothing is added for you", () => {
    const grocery = [
      { id: "1", name: "Milk", done: false, addedAt: 1 },
      { id: "2", name: "Sugar", done: false, addedAt: 2 },
      { id: "3", name: "Eggs", done: true, addedAt: 3 },
    ];
    const list = planNotifications(seeded({ grocery }), MON);
    const run = list.find((n) => n.key.startsWith("bill:grocery:2026-10-10"))!;
    expect(run.body).toContain("Buy: Milk, Sugar.");
    expect(run.body).not.toContain("Eggs");
    const none = planNotifications(seeded(), MON).find((n) => n.key.startsWith("bill:grocery:2026-10-10"))!;
    expect(none.body).toContain("Nothing on your list yet");
  });
});

describe("nudges", () => {
  it("flags an empty tomorrow", () => {
    const bare: AppData = { version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 9, 1).getTime() }, profile: defaultProfile() };
    expect(computeNudges(bare, TUE).some((n) => n.id === "empty-day")).toBe(true);
    const busy = { ...bare, events: [ev({})] };
    expect(computeNudges(busy, TUE).some((n) => n.id === "empty-day")).toBe(false);
  });

  it("leaves weekends alone: they're meant to be light", () => {
    const bare: AppData = { version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 9, 1).getTime() }, profile: defaultProfile() };
    expect(computeNudges(bare, new Date(2026, 9, 9, 20, 0)).some((n) => n.id === "empty-day")).toBe(false); // Friday: tomorrow is Saturday
  });

  it("notices a neglected area: 'No meditation in 5 days'", () => {
    // Last on Monday 28 Sept: five weekdays (29, 30, 1, 2, 5 Oct) without one. Meditation is weekdays only.
    const sessions = [{ id: "m", areaId: "meditation", date: "2026-09-28", minutes: 15, n: 1, at: 1, source: "checkin" as const }];
    const d = seeded({ sessions, settings: { firstRunAt: new Date(2026, 8, 1).getTime(), seeded: 0 } }, MON);
    const nudge = computeNudges(d, new Date(2026, 9, 5, 20, 0)).find((n) => n.id === "neglect:meditation" || n.id === "behind:meditation");
    expect(nudge).toBeDefined();
  });

  it("flags falling behind a weekly target, gently", () => {
    const d = seeded({}, MON);
    const nudges = computeNudges(d, new Date(2026, 9, 9, 20, 30)); // Friday evening, nothing done
    const pbi = nudges.find((n) => n.id === "behind:powerbi")!;
    expect(pbi.text).toContain("Power BI");
    expect(pbi.text).toMatch(/behind/);
  });

  it("a dismissed nudge stays quiet for the day", () => {
    const d = seeded({}, MON);
    const now = new Date(2026, 9, 9, 20, 30);
    const key = "nudge:behind:powerbi:2026-10-09";
    const quiet = { ...d, log: [{ key, status: "skip" as const, at: 1 }] };
    expect(computeNudges(quiet, now).some((n) => n.id === "behind:powerbi")).toBe(false);
  });

  it("sends one nudge notification a day at the nudge time", () => {
    const d = seeded({}, MON);
    const list = planNotifications(d, new Date(2026, 9, 9, 7, 0));
    const n = list.find((x) => x.key === "nudge:2026-10-09")!;
    expect(n.kind).toBe("nudge");
    expect(hm(n.at)).toBe("21:00");
  });

  it("a new month with no must-haves asks for them", () => {
    const d = seeded({}, MON);
    expect(computeNudges(d, new Date(2026, 10, 2, 10, 0)).some((n) => n.id === "goals")).toBe(true);
    expect(computeNudges({ ...d, goals: { month: "2026-11", items: [] } }, new Date(2026, 10, 2, 10, 0)).some((n) => n.id === "goals")).toBe(false);
  });
});

describe("Sunday review", () => {
  it("is announced on Sunday at the review time, until you've done it", () => {
    const d = seeded({}, MON);
    const list = planNotifications(d, new Date(2026, 9, 9, 7, 0));
    const r = list.find((n) => n.key === "review:2026-10-11")!;
    expect([r.kind, hm(r.at)]).toEqual(["review", "18:30"]);
    const done = planNotifications({ ...d, settings: { ...d.settings, reviewWeek: "2026-10-05" } }, new Date(2026, 9, 9, 7, 0));
    expect(done.some((n) => n.key === "review:2026-10-11")).toBe(false);
  });
});

describe("old backups", () => {
  it("a save with no events, bills or goals still loads and gets the defaults", () => {
    const d = seeded({}, MON);
    expect(d.bills?.length).toBeGreaterThan(5);
    expect(d.bored?.length).toBeGreaterThan(3);
    expect(toHHMM(0)).toBe("00:00");
  });
});
