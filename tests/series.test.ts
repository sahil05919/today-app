import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, needsUpgrade } from "../lib/backup";
import { addDays } from "../lib/dates";
import { completeTaskIn } from "../lib/done";
import { hashId, planNotifications } from "../lib/notifications/plan";
import { getOccurrences, editSeries, makeSeries, occKey, seriesDates, sweepMissed, withOccurrences } from "../lib/series";
import { BACKUP_KEY, BACKUP_KEY_V3, BACKUP_KEY_V4, KEY, localStorageAdapter } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import { upcomingDays } from "../lib/upcoming";
import type { AppData, Series } from "../lib/types";

// Mon 12 Oct 2026, 08:00 London. UK clocks go back on Sun 25 Oct 2026.
const NOW = new Date(2026, 9, 12, 8, 0);
const TODAY = "2026-10-12";
const DAILY = { freq: "daily" as const, interval: 1 };

const vitamin = (over: Partial<Parameters<typeof makeSeries>[0]> = {}): Series => makeSeries({ id: "vit", title: "Vitamin", time: "11:00", rule: DAILY, from: TODAY, createdAt: 1, ...over });
const data = (series: Series[], extra: Partial<AppData> = {}): AppData => ({ version: 2, tasks: [], settings: { firstRunAt: 1 }, series, ...extra });
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const reminders = (d: AppData, now: Date) => planNotifications(d, now).filter((n) => n.kind === "reminder" && n.title === "Vitamin" && !n.key.includes(":nag"));

describe("A1. 'Every day · 11:00' shows on every coming day", () => {
  const d = data([vitamin()]);

  it("in the Calendar (a timeline per day) at 11:00, fixed", () => {
    for (const day of days(TODAY, 7)) {
      const it = buildTimeline(d, day, NOW).items.find((x) => x.title === "Vitamin");
      expect(it, day).toBeTruthy();
      expect([it!.start, it!.fixed, it!.done]).toEqual([11 * 60, true, false]);
    }
  });

  it("in Coming up, each of the next days carries the time", () => {
    for (const u of upcomingDays(d, TODAY, 3, 3)) {
      expect(u.top.some((t) => t.title === "Vitamin" && t.time === "11:00"), u.date).toBe(true);
    }
  });

  it("on Today", () => {
    expect(buildTimeline(d, TODAY, NOW).items.some((x) => x.title === "Vitamin" && x.start === 660)).toBe(true);
  });

  it("is computed, never generated: nothing is stored per day", () => {
    expect(d.tasks).toHaveLength(0);
    expect(d.occurrences).toBeUndefined();
    expect(getOccurrences(d, TODAY, addDays(TODAY, 29), TODAY)).toHaveLength(30);
  });
});

describe("A2. 11:00 reminders, every day, across the clock change on Sun 25 Oct", () => {
  const FRI = new Date(2026, 9, 23, 8, 0);
  const list = reminders(data([vitamin({ from: "2026-10-23" })]), FRI);

  it("schedules one per day for the whole 14-day window", () => {
    const dates = list.map((n) => n.key.split("@")[1]);
    for (const day of days("2026-10-23", 14)) expect(dates, day).toContain(day);
    expect(new Set(list.map((n) => n.id)).size).toBe(list.length);
  });

  it("11:00 stays 11:00 London time before, on and after the change", () => {
    const by = Object.fromEntries(list.map((n) => [n.key.split("@")[1], n.at]));
    for (const day of ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-11-02"]) expect(hhmm(by[day]), day).toBe("11:00");
    // The same wall-clock time is a different UTC hour: 10:00Z while BST, 11:00Z after.
    expect(by["2026-10-24"].getUTCHours()).toBe(10);
    expect(by["2026-10-26"].getUTCHours()).toBe(11);
  });

  it("has stable ids derived from the occurrence key", () => {
    const n = list.find((x) => x.key === `reminder:vit@2026-10-25`)!;
    expect(n.id).toBe(hashId("reminder:vit@2026-10-25"));
    expect(n.taskId).toBe("vit@2026-10-25");
    expect(planNotifications(data([vitamin({ from: "2026-10-23" })]), FRI).map((x) => x.id)).toEqual(planNotifications(data([vitamin({ from: "2026-10-23" })]), FRI).map((x) => x.id));
  });
});

describe("A3. ticking today leaves tomorrow alone", () => {
  it("marks only that occurrence, no duplicate, nothing generated", () => {
    const d = data([vitamin()]);
    const r = completeTaskIn(d, occKey("vit", TODAY), NOW)!;
    expect(r.next).toBeNull();
    expect(r.data.tasks).toHaveLength(0);
    const occ = getOccurrences(r.data, TODAY, addDays(TODAY, 7), TODAY);
    expect(occ.map((o) => [o.date, o.status])).toEqual([[TODAY, "done"], ...days(addDays(TODAY, 1), 7).map((x) => [x, "open"])]);
    // tomorrow is still on the timeline once, at 11:00, with its reminder
    const tomorrow = addDays(TODAY, 1);
    expect(buildTimeline(r.data, tomorrow, NOW).items.filter((x) => x.title === "Vitamin")).toHaveLength(1);
    expect(reminders(r.data, NOW).some((n) => n.key === `reminder:vit@${tomorrow}`)).toBe(true);
    // ...and today's, now done, rings no more
    expect(reminders(r.data, new Date(2026, 9, 12, 7, 0)).some((n) => n.key === `reminder:vit@${TODAY}`)).toBe(false);
  });
});

describe("A4. changing the series", () => {
  const d = data([vitamin()]);
  const day3 = addDays(TODAY, 3);

  it("'This and future' 10:30 updates future occurrences and their notifications; the past keeps 11:00", () => {
    const { data: after, openId } = editSeries(d, occKey("vit", day3), { time: "10:30" }, "future");
    expect(openId.endsWith(`@${day3}`)).toBe(true);
    const timeOf = (day: string) => buildTimeline(after, day, NOW).items.find((x) => x.title === "Vitamin")?.start;
    expect([timeOf(TODAY), timeOf(addDays(TODAY, 2))]).toEqual([660, 660]);
    expect([timeOf(day3), timeOf(addDays(TODAY, 6))]).toEqual([630, 630]);
    const n = reminders(after, NOW);
    const at = (day: string) => hhmm(n.find((x) => x.key.endsWith(`@${day}`))!.at);
    expect([at(TODAY), at(day3), at(addDays(TODAY, 5))]).toEqual(["11:00", "10:30", "10:30"]);
    // exactly one reminder per day: nothing duplicated by the split
    expect(new Set(n.map((x) => x.key.split("@")[1])).size).toBe(n.length);
  });

  it("'This one only' changes a single day", () => {
    const { data: after } = editSeries(d, occKey("vit", day3), { time: "09:15" }, "this");
    const timeOf = (day: string) => buildTimeline(after, day, NOW).items.find((x) => x.title === "Vitamin")?.start;
    expect([timeOf(addDays(day3, -1)), timeOf(day3), timeOf(addDays(day3, 1))]).toEqual([660, 555, 660]);
    expect(after.occurrences).toHaveLength(1);
  });

  it("turning repeat off removes later occurrences and their notifications; history stays", () => {
    const done = completeTaskIn(d, occKey("vit", TODAY), NOW)!.data;
    const { data: after } = editSeries(done, occKey("vit", day3), { rule: null }, "future");
    const occ = getOccurrences(after, TODAY, addDays(TODAY, 30), TODAY).filter((o) => o.status === "open" || o.status === "done");
    // today (done) and the days before the change remain; day 3 became an ordinary one-off task, nothing after it repeats
    expect(occ.map((o) => o.date)).toEqual([TODAY, addDays(TODAY, 1), addDays(TODAY, 2)]);
    expect(occ[0].status).toBe("done");
    const keys = reminders(after, NOW).map((n) => n.key);
    expect(keys.filter((k) => k.endsWith(`@${addDays(TODAY, 4)}`))).toHaveLength(0);
    expect(after.tasks.filter((t) => t.title === "Vitamin")).toHaveLength(1);
  });
});

describe("A5. rules", () => {
  const dates = (rule: Series["rule"], from: string, n = 14, over: Partial<Series> = {}) => seriesDates({ ...vitamin({ rule, from }), ...over }, from, addDays(from, n - 1));

  it("weekdays skip the weekend", () => {
    expect(dates({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] }, "2026-10-12", 9)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
  });
  it("weekly on chosen days", () => {
    expect(dates({ freq: "weekly", interval: 1, weekdays: [2, 4] }, "2026-10-12", 14)).toEqual(["2026-10-13", "2026-10-15", "2026-10-20", "2026-10-22"]);
  });
  it("every other week counts weeks from the start", () => {
    expect(dates({ freq: "weekly", interval: 2, weekdays: [1] }, "2026-10-12", 28)).toEqual(["2026-10-12", "2026-10-26"]);
  });
  it("every 3 days is anchored, not drifting with completion", () => {
    expect(dates({ freq: "daily", interval: 3 }, "2026-10-12", 10)).toEqual(["2026-10-12", "2026-10-15", "2026-10-18", "2026-10-21"]);
    const d = data([vitamin({ rule: { freq: "daily", interval: 3 } })]);
    const late = completeTaskIn(d, occKey("vit", "2026-10-15"), new Date(2026, 9, 17, 9, 0))!.data;
    expect(getOccurrences(late, "2026-10-12", "2026-10-24", "2026-10-17").filter((o) => o.status === "open").map((o) => o.date)).toEqual(["2026-10-12", "2026-10-18", "2026-10-21", "2026-10-24"]);
  });
  it("monthly on day N clamps to short months", () => {
    expect(dates({ freq: "monthly", interval: 1, monthDay: 31 }, "2026-01-31", 120)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});

describe("A6. migration of the old model", () => {
  // What the previous build saved: an open repeating task plus the copies finishing it generated.
  const task = (over: Record<string, unknown>) => ({ id: "x", title: "Vitamin", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, dueTime: "11:00", recur: DAILY, area: "health", ...over });
  const old = {
    version: 1,
    settings: { firstRunAt: 1 },
    tasks: [
      task({ id: "c1", due: "2026-10-09", status: "done", completedAt: Date.UTC(2026, 9, 9, 11, 5), nextId: "c2" }),
      task({ id: "c2", due: "2026-10-10", status: "done", completedAt: Date.UTC(2026, 9, 10, 11, 2), nextId: "c3" }),
      task({ id: "c3", due: "2026-10-11", status: "done", completedAt: Date.UTC(2026, 9, 11, 11, 7), nextId: "c4" }),
      task({ id: "c4", due: "2026-10-12", status: "open" }),
      { id: "plain", title: "Buy milk", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 5, due: "2026-10-13" },
    ],
  };

  it("turns the task and its copies into ONE series with the done days kept", () => {
    const out = migrate(old);
    expect(out.version).toBe(4);
    expect(out.tasks.map((t) => t.title)).toEqual(["Buy milk"]);
    expect(out.series).toHaveLength(1);
    expect(out.series![0]).toMatchObject({ title: "Vitamin", time: "11:00", area: "health", rule: DAILY, startDate: "2026-10-09" });
    const occ = getOccurrences(out, "2026-10-09", "2026-10-14", "2026-10-12");
    expect(occ.map((o) => [o.date, o.status])).toEqual([["2026-10-09", "done"], ["2026-10-10", "done"], ["2026-10-11", "done"], ["2026-10-12", "open"], ["2026-10-13", "open"], ["2026-10-14", "open"]]);
    expect(occ.every((o) => o.time === "11:00")).toBe(true);
    // done stamps survive
    expect(occ[1].task.completedAt).toBe(Date.UTC(2026, 9, 10, 11, 2));
  });

  it("is idempotent and has no duplicates", () => {
    const once = migrate(old);
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice.series).toHaveLength(1);
    expect(twice.occurrences).toHaveLength(once.occurrences!.length);
    expect(withOccurrences(twice, "2026-10-09", "2026-10-14", "2026-10-12").tasks.filter((t) => t.title === "Vitamin")).toHaveLength(6);
  });

  it("only upgrades data from the older schema", () => {
    expect(needsUpgrade(old)).toBe(true);
    expect(needsUpgrade(migrate(old))).toBe(false);
  });
});

describe("A6b. the old data is backed up under its own key before anything changes", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const raw = JSON.stringify({ version: 1, settings: { firstRunAt: 1 }, tasks: [{ id: "a", title: "Vitamin", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, due: "2026-10-12", dueTime: "11:00", recur: DAILY }] });

  it("copies the exact old JSON (under the v2, v3 and v4 keys), migrates, saves v4, and never overwrites a backup", () => {
    store.set(KEY, raw);
    const loaded = localStorageAdapter.load()!;
    expect(BACKUP_KEY).toBe("today:v1:backup-pre-v2");
    expect(store.get(BACKUP_KEY)).toBe(raw);
    expect(BACKUP_KEY_V3).toBe("today:v1:backup-pre-v3");
    expect(store.get(BACKUP_KEY_V3)).toBe(raw);
    expect(BACKUP_KEY_V4).toBe("today:v1:backup-pre-v4");
    expect(store.get(BACKUP_KEY_V4)).toBe(raw);
    expect(loaded.version).toBe(4);
    expect(JSON.parse(store.get(KEY)!).version).toBe(4);
    expect(loaded.series).toHaveLength(1);
    // A second load (already v2) leaves the backup alone; even a different v1 save would not replace it.
    localStorageAdapter.load();
    expect(store.get(BACKUP_KEY)).toBe(raw);
    store.set(KEY, raw.replace("Vitamin", "Other"));
    localStorageAdapter.load();
    expect(store.get(BACKUP_KEY)).toBe(raw);
    expect(store.get(BACKUP_KEY_V4)).toBe(raw);
  });

  it("a v3 save (the assistant pass) is backed up under the v4 key only, and migrating twice changes nothing", () => {
    const v3 = JSON.stringify({ version: 3, settings: { firstRunAt: 1 }, tasks: [] });
    store.set(KEY, v3);
    const first = localStorageAdapter.load()!;
    expect(store.get(BACKUP_KEY_V4)).toBe(v3);
    expect(store.has(BACKUP_KEY)).toBe(false);
    expect(store.has(BACKUP_KEY_V3)).toBe(false);
    expect(first.version).toBe(4);
    const again = localStorageAdapter.load()!;
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(store.get(BACKUP_KEY_V4)).toBe(v3);
  });
});

describe("older unresolved repeats carry once (B-ready)", () => {
  it("a daily item missed three days running shows once", () => {
    const d = data([vitamin({ from: "2026-10-09" })]);
    const today = "2026-10-12";
    const open = getOccurrences(d, "2026-10-09", today, today).filter((o) => o.status === "open" && o.on < today);
    expect(open.map((o) => o.date)).toEqual(["2026-10-11"]);
    const swept = sweepMissed(d, today);
    expect(swept.occurrences!.filter((r) => r.status === "missed").map((r) => r.date)).toEqual(["2026-10-09", "2026-10-10"]);
    // sweeping again changes nothing
    expect(sweepMissed(swept, today)).toBe(swept);
  });
});
