import { describe, expect, it } from "vitest";
import { quoteMinute } from "../lib/brief";
import { addDays, toISO } from "../lib/dates";
import { applyBudget, DAILY_BUDGET, isExempt } from "../lib/notifications/budget";
import { planNotifications, type PlannedNotification } from "../lib/notifications/plan";
import { QUOTE_LIBRARY, quoteAtSlot, quoteStateOf } from "../lib/quoteBag";
import { seedIfNeeded } from "../lib/seed";
import { makeSeries } from "../lib/series";
import type { AppData, FixedEvent, Task } from "../lib/types";

// Wed 7 Oct 2026, 07:00: everything is behind pace, so every area could nudge. The week is the busiest case.
const WED = new Date(2026, 9, 7, 7, 0);
const seeded = (over: Partial<AppData> = {}): AppData => seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() }, ...over }, WED);
const vit = makeSeries({ id: "vit", title: "All Vitamin", time: "11:00", rule: { freq: "daily", interval: 1 }, from: "2026-10-07" });
const ev = (id: string, date: string, start: string, end: string): FixedEvent => ({ id, title: id, date, start, end, createdAt: 1 });
const task = (o: Partial<Task>): Task => ({ id: Math.random().toString(36).slice(2), title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, ...o });
const perDay = (list: PlannedNotification[], pred: (n: PlannedNotification) => boolean) => {
  const m = new Map<string, PlannedNotification[]>();
  for (const n of list.filter(pred)) m.set(toISO(n.at), [...(m.get(toISO(n.at)) ?? []), n]);
  return m;
};

describe("3. the notification budget: few but worth it", () => {
  const busy = seeded({
    series: [vit],
    tasks: [task({ title: "Pay card", due: "2026-10-08", dueTime: "09:00" }), task({ title: "Call the bank", due: "2026-10-08", important: true }), task({ title: "Reply to Sam", due: "2026-10-09" })],
    events: [ev("Dinner", "2026-10-08", "19:00", "21:00"), ev("Class", "2026-10-09", "18:00", "19:30")],
  });
  const free = planNotifications(busy, WED, { budget: Infinity });
  const list = planNotifications(busy, WED);

  it("without the budget a busy day has far more than five", () => {
    const max = Math.max(...[...perDay(free, (n) => !isExempt(n)).values()].map((l) => l.length));
    expect(max).toBeGreaterThan(DAILY_BUDGET);
  });

  it("with it, no day has more than 5 that lack a fixed time", () => {
    for (const [day, l] of perDay(list, (n) => !isExempt(n))) expect(l.length, day).toBeLessThanOrEqual(DAILY_BUDGET);
  });

  it("never touches what has a time of its own: the vitamin, timed tasks, events, bills", () => {
    const keep = (l: PlannedNotification[]) => l.filter(isExempt).map((n) => n.key).sort();
    expect(keep(list)).toEqual(keep(free));
    expect(list.filter((n) => n.kind === "reminder" && n.title === "All Vitamin" && !n.key.includes(":nag")).length).toBeGreaterThanOrEqual(13);
    expect(list.some((n) => n.kind === "event")).toBe(true);
  });

  it("drops the lowest value first: the quote and the check-ins stay, the rhythm pings and conscience nudge go", () => {
    const day = "2026-10-09";
    const kept = list.filter((n) => toISO(n.at) === day && !isExempt(n));
    expect(kept.some((n) => n.kind === "tonight")).toBe(true);
    expect(kept.some((n) => n.kind === "quote")).toBe(true);
    expect(kept.some((n) => n.key.startsWith("rhythm:"))).toBe(false);
    expect(kept.some((n) => n.key.startsWith("nudge:"))).toBe(false);
  });

  it("when only one session nudge fits, the area furthest behind keeps it", () => {
    // (Friday is full of the weekly review, so use a Monday: the brief, quote, check-in and end of day leave room for one.)
    const day = "2026-10-12";
    const sessions = list.filter((n) => toISO(n.at) === day && n.kind === "session");
    const all = free.filter((n) => toISO(n.at) === day && n.kind === "session");
    expect(all.length).toBeGreaterThan(sessions.length);
    const best = Math.max(...all.map((n) => n.value ?? 0));
    expect(Math.max(...sessions.map((n) => n.value ?? 0))).toBe(best);
  });

  it("applyBudget on its own: the same input gives the same answer, and it keeps order", () => {
    expect(applyBudget(list).map((n) => n.key)).toEqual(list.map((n) => n.key));
    expect(applyBudget(free, 2).filter((n) => !isExempt(n) && toISO(n.at) === "2026-10-08").length).toBe(2);
  });
});

describe("3. the quote", () => {
  const d = seeded();
  const quotes = planNotifications(d, WED).filter((n) => n.kind === "quote");

  it("is its own notification every day, between 11:00 and 16:00, a different moment most days", () => {
    expect(quotes.length).toBeGreaterThanOrEqual(13);
    const days = quotes.map((q) => toISO(q.at));
    expect(new Set(days).size).toBe(days.length);
    const minutes = quotes.map((q) => q.at.getHours() * 60 + q.at.getMinutes());
    expect(minutes.every((m) => m >= 11 * 60 && m <= 16 * 60 && m % 5 === 0)).toBe(true);
    expect(new Set(minutes).size).toBeGreaterThan(5);
  });

  it("is a popup on time (exact), so it cannot be buried or delayed like the quiet check-ins", () => {
    expect(quotes.every((q) => q.exact && !q.actions)).toBe(true);
  });

  it("keeps its moment when the plan is re-run", () => {
    const again = planNotifications(d, WED).filter((n) => n.kind === "quote");
    expect(again.map((q) => q.at.getTime())).toEqual(quotes.map((q) => q.at.getTime()));
    expect(quoteMinute(d, "2026-10-12", "11:00", "16:00")).toBe(quoteMinute(d, "2026-10-12", "11:00", "16:00"));
  });

  it("follows the window you set, and switches off", () => {
    const narrow: AppData = { ...d, profile: { ...d.profile!, quoteFrom: "14:00", quoteTo: "14:30" } };
    for (const q of planNotifications(narrow, WED).filter((n) => n.kind === "quote")) expect(q.at.getHours() * 60 + q.at.getMinutes()).toBeGreaterThanOrEqual(14 * 60);
    const off: AppData = { ...d, profile: { ...d.profile!, notify: { ...d.profile!.notify, quote: false } } };
    expect(planNotifications(off, WED).some((n) => n.kind === "quote")).toBe(false);
  });

  it("has a local pool of at least 300 English and 300 Hinglish lines, and nothing repeats until a pool is used up", () => {
    expect(QUOTE_LIBRARY.en.length).toBeGreaterThanOrEqual(300);
    expect(QUOTE_LIBRARY.hi.length).toBeGreaterThanOrEqual(300);
    const seed = quoteStateOf(d).seed;
    const n = 600; // 300 of each language, alternating
    const ids = Array.from({ length: n }, (_, i) => quoteAtSlot(seed, i).id);
    expect(new Set(ids).size).toBe(n);
  });
});

describe("3. the morning brief and the evening check-in", () => {
  it("opening the app cancels today's brief but not tomorrow's", () => {
    const d = seeded({ tasks: [task({ title: "Call the bank", due: "2026-10-07" }), task({ title: "Pay rent", due: "2026-10-08" })] });
    const before = planNotifications(d, WED, { budget: Infinity });
    expect(before.some((n) => n.key === "morning:2026-10-07")).toBe(true);
    const opened: AppData = { ...d, settings: { ...d.settings, openedDate: "2026-10-07" } };
    const after = planNotifications(opened, WED, { budget: Infinity });
    expect(after.some((n) => n.key === "morning:2026-10-07")).toBe(false);
    expect(after.some((n) => n.key === "morning:2026-10-08")).toBe(true);
    // An opening yesterday says nothing about today.
    const yesterday: AppData = { ...d, settings: { ...d.settings, openedDate: addDays("2026-10-07", -1) } };
    expect(planNotifications(yesterday, WED, { budget: Infinity }).some((n) => n.key === "morning:2026-10-07")).toBe(true);
  });

  it("the brief is one line: the must-dos and one focus", () => {
    const d = seeded({ tasks: [task({ title: "Call the bank", due: "2026-10-08" })] });
    const m = planNotifications(d, WED, { budget: Infinity }).find((n) => n.key === "morning:2026-10-08")!;
    expect(m.body.split("\n")).toHaveLength(1);
    expect(m.body).toMatch(/^Today: Call the bank\. Focus: .+ is behind\.$/);
  });

  it("the evening check-in is at 20:00, names what is left, and asks about email", () => {
    const t = planNotifications(seeded(), WED, { budget: Infinity }).find((n) => n.key === "tonight:2026-10-07")!;
    expect(`${t.at.getHours()}:${t.at.getMinutes()}`).toBe("20:0");
    expect(t.body).toMatch(/^Tonight: .+\. Anything from email to add\?$/);
  });

  it("every time is editable and every kind can be switched off", () => {
    const d = seeded();
    const moved: AppData = { ...d, profile: { ...d.profile!, briefTime: "08:40", checkinTime: "19:15", eveningWrap: "21:30" } };
    const l = planNotifications({ ...moved, tasks: [task({ title: "A", due: "2026-10-08" })] }, WED, { budget: Infinity });
    const at = (key: string) => l.find((n) => n.key === key)!.at;
    expect([at("morning:2026-10-08").getHours(), at("morning:2026-10-08").getMinutes()]).toEqual([8, 40]);
    expect([at("tonight:2026-10-08").getHours(), at("tonight:2026-10-08").getMinutes()]).toEqual([19, 15]);
    expect([at("wrap:2026-10-08").getHours(), at("wrap:2026-10-08").getMinutes()]).toEqual([21, 30]);
    const off: AppData = { ...moved, tasks: [task({ title: "A", due: "2026-10-08" })], profile: { ...moved.profile!, notify: { ...moved.profile!.notify, morning: false, tonight: false, wrap: false, quote: false, sessionNudges: false } } };
    const none = planNotifications(off, WED, { budget: Infinity }).filter((n) => ["morning", "tonight", "wrap", "quote", "session"].includes(n.kind));
    expect(none).toEqual([]);
  });
});
