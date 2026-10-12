import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../lib/backup";
import { addDays } from "../lib/dates";
import { planNotifications } from "../lib/notifications/plan";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { actions, flushNow, getData } from "../lib/store";
import { resolveTap } from "../lib/tap";
import { catchUpSuggestions, compare, focusFor, slipped, snapshotsDue, soFarText, weekStats, wins, yourWeekText } from "../lib/weekly";
import type { AppData, SessionLog, Task } from "../lib/types";

// Fri 16 Oct 2026, 21:05 London. The week is Mon 12 … Sun 18; last week is Mon 5 … Sun 11.
const FRI = new Date(2026, 9, 16, 21, 5);
const SUN = new Date(2026, 9, 18, 21, 5);
const WEEK = "2026-10-12";
const stamp = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00`).getTime();
let n = 0;
const log = (areaId: string, date: string, i = ++n): SessionLog => ({ id: `l${i}`, areaId, date, minutes: 30, n: i, at: stamp(date), source: "manual" });
const mine = (o: Partial<Task>): Task => ({ id: `m${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: stamp("2026-10-13"), ...o });
const day = (i: number, from = WEEK) => addDays(from, i);

/** This week: Power BI 3/4, Meditation 3/3, Job 0/5, English 4/7, Walking 2/6. Last week: Power BI 4, Meditation 2, Job 2, English 3, Walking 2. */
function sample(): AppData {
  const base = seedIfNeeded({ version: 2, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, FRI);
  const sessions = [
    ...["powerbi", "powerbi", "powerbi"].map((a, i) => log(a, day(i))),
    ...[0, 1, 2].map((i) => log("meditation", day(i))),
    ...[0, 1, 2, 3].map((i) => log("english", day(i))),
    ...[1, 3].map((i) => log("walking", day(i))),
    ...[0, 1, 2, 3].map((i) => log("powerbi", day(i, "2026-10-05"))),
    ...[0, 1].map((i) => log("meditation", day(i, "2026-10-05"))),
    ...[0, 1].map((i) => log("job", day(i, "2026-10-05"))),
    ...[0, 1, 2].map((i) => log("english", day(i, "2026-10-05"))),
    ...[0, 1].map((i) => log("walking", day(i, "2026-10-05"))),
  ];
  const own = [
    mine({ title: "Book dentist", status: "done", completedAt: stamp("2026-10-13") }),
    mine({ title: "Reply to Sam", status: "done", completedAt: stamp("2026-10-14") }),
    mine({ title: "Renew passport photo", status: "done", completedAt: stamp("2026-10-15") }),
    mine({ title: "Call the plumber", status: "done", completedAt: stamp("2026-10-15") }),
    mine({ title: "Sort the loft", due: "2026-10-20" }),
    // made by the app: never one of "your" tasks
    mine({ title: "Walking session", generated: true, countsFor: "walking", due: "2026-10-17" }),
    // added in an earlier week
    mine({ title: "Old thing", createdAt: stamp("2026-10-01"), status: "done", completedAt: stamp("2026-10-02") }),
  ];
  return { ...base, sessions, tasks: own, calendarEvents: [{ id: "cal:9:2026-10-14", calId: "9", title: "Team sync", date: "2026-10-14", start: "15:00", end: "15:30", createdAt: 1, source: "calendar" }], eventMarks: { "9@2026-10-14": { done: stamp("2026-10-14") } } };
}

describe("D. weekly numbers", () => {
  const d = sample();
  const s = weekStats(d, WEEK, "2026-10-16");
  const prev = weekStats(d, "2026-10-05", "2026-10-16");

  it("done / target per area, and the overall percent", () => {
    expect(Object.fromEntries(s.areas.map((a) => [a.id, `${a.done}/${a.target}`]))).toMatchObject({ powerbi: "3/4", meditation: "3/3", job: "0/5", english: "4/7", walking: "2/6" });
    expect(s.percent).toBe(Math.round(((3 + 3 + 0 + 4 + 2) / (4 + 3 + 5 + 7 + 6)) * 100));
  });

  it("wins are at or above target, slipped are below", () => {
    expect(wins(s).map((a) => a.id)).toEqual(["meditation"]);
    expect(slipped(s).map((a) => a.id).sort()).toEqual(["english", "job", "powerbi", "walking"]);
  });

  it("your own tasks: you added 5, finished 4 (the app's own and last week's are not counted)", () => {
    expect(s.own.added).toBe(5);
    expect(s.own.finished).toBe(4);
    expect(s.own.names.sort()).toEqual(["Book dentist", "Call the plumber", "Renew passport photo", "Reply to Sam"]);
    expect(s.own.stillOpen).toEqual(["Sort the loft"]);
  });

  it("calendar events handled are listed", () => {
    expect(s.events).toEqual({ handled: 1, names: ["Team sync"] });
  });

  it("this week against last week, per area, with arrows", () => {
    const c = Object.fromEntries(compare(s, prev).map((x) => [x.id, x.arrow]));
    expect(c).toMatchObject({ powerbi: "↓", meditation: "↑", job: "↓", english: "↑", walking: "=" });
  });

  it("the focus is the one or two areas with the lowest done / target", () => {
    expect(focusFor(s).map((a) => a.id)).toEqual(["job", "walking"]);
  });

  it("the words are honest and kind: no guilt, and the facts are there", () => {
    const t = yourWeekText(s, prev, "Sahil");
    const all = [t.headline, ...t.lines].join(" ");
    expect(all).toContain("You added 5, finished 4");
    expect(all).toContain("Wins: Meditation");
    expect(all).toMatch(/Slipped: .*Job Apply|Slipped: .*Job/);
    expect(all).toContain("Focus for next week:");
    expect(all).not.toMatch(/fail|lazy|disappoint|should have|bad|guilt/i);
  });
});

describe("D. Friday: catch-up suggestions add nothing without a tap", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    actions.replaceAll(sample());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("at most two, on the weekend, each day light", () => {
    const sug = catchUpSuggestions(getData(), FRI);
    expect(sug.length).toBeLessThanOrEqual(2);
    expect(sug.length).toBeGreaterThan(0);
    for (const c of sug) expect(["2026-10-17", "2026-10-18"]).toContain(c.date);
    expect(sug.every((c) => /^Add to (Sat|Sun)$/.test(c.label))).toBe(true);
    const text = soFarText(weekStats(getData(), WEEK, "2026-10-16"), "Sahil", sug);
    expect(text.lines.join(" ")).toContain("Nothing is added unless you tap");
  });

  it("nothing is added until you tap Add to Sat / Sun", () => {
    const before = getData().tasks.length;
    const sug = catchUpSuggestions(getData(), FRI);
    soFarText(weekStats(getData(), WEEK, "2026-10-16"), "Sahil", sug);
    expect(getData().tasks).toHaveLength(before);
    const undo = actions.addCatchUp(sug[0], FRI)!;
    expect(getData().tasks).toHaveLength(before + 1);
    expect(getData().tasks[0]).toMatchObject({ countsFor: sug[0].areaId, due: sug[0].date, generated: true });
    undo();
    expect(getData().tasks).toHaveLength(before);
  });

  it("an added catch-up counts toward the week once it is done, and is never counted as your own task", () => {
    const sug = catchUpSuggestions(getData(), FRI)[0];
    actions.addCatchUp(sug, FRI);
    const id = getData().tasks[0].id;
    const before = weekStats(getData(), WEEK, "2026-10-17").areas.find((a) => a.id === sug.areaId)!.done;
    actions.toggleDone(id, new Date(2026, 9, 17, 10, 0));
    const after = weekStats(getData(), WEEK, "2026-10-17");
    expect(after.areas.find((a) => a.id === sug.areaId)!.done).toBe(before + 1);
    expect(after.own.added).toBe(5);
  });
});

describe("D. the history log", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    actions.replaceAll(seedIfNeeded({ version: 2, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, FRI));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("appends done / skipped / rescheduled with the type and who made it; undo appends 'reopened'", () => {
    const t = actions.addTask({ title: "Book dentist", due: "2026-10-16", important: false, tags: [] });
    actions.toggleDone(t.id, FRI);
    actions.toggleDone(t.id, FRI);
    actions.addSession("walking", "2026-10-16", "manual", FRI);
    const u = actions.addTask({ title: "Call Sam", due: "2026-10-16", important: false, tags: [] });
    actions.reschedule({ kind: "task", taskId: u.id }, { kind: "pick", date: "2026-10-17", time: "10:00" }, FRI);
    const v = actions.addTask({ title: "Water plants", due: "2026-10-16", important: false, tags: [] });
    actions.skipTask(v.id, FRI);
    const h = getData().history!;
    const kinds = h.map((e) => [e.kind, e.type, e.createdByMe, e.title]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["done", "task", true, "Book dentist"],
        ["reopened", "task", true, "Book dentist"],
        ["done", "session", false, "Walking session 1"],
        ["rescheduled", "task", true, "Call Sam"],
        ["skipped", "task", true, "Water plants"],
      ]),
    );
    expect(h.find((e) => e.kind === "rescheduled")!.to).toEqual({ date: "2026-10-17", time: "10:00" });
    // append-only: every entry has an id and a time
    expect(h.every((e) => !!e.id && e.at > 0)).toBe(true);
  });

  it("is saved and survives a reload (the cleaner keeps it)", async () => {
    const t = actions.addTask({ title: "Book dentist", due: "2026-10-16", important: false, tags: [] });
    actions.toggleDone(t.id, FRI);
    await flushNow();
    const reloaded = migrate(JSON.parse(store.get("today:v1")!));
    expect(reloaded.history!.some((e) => e.title === "Book dentist" && e.kind === "done")).toBe(true);
  });

  it("a ticked event is 'handled', and a repeat's day counts on its own", () => {
    actions.replaceAll({ ...getData(), calendarEvents: [{ id: "cal:9:2026-10-16", calId: "9", title: "Team sync", date: "2026-10-16", start: "15:00", end: "15:30", createdAt: 1, source: "calendar" }] });
    actions.markEvent("9@2026-10-16", { done: 5 });
    expect(getData().history!.some((e) => e.type === "event" && e.kind === "done" && e.title === "Team sync")).toBe(true);
    expect(weekStats(getData(), WEEK, "2026-10-16").events.handled).toBe(1);
  });

  it("the current week is backfilled from existing data when the app is upgraded", () => {
    const old = {
      version: 1,
      settings: { firstRunAt: 1 },
      tasks: [{ id: "a", title: "Book dentist", important: false, tags: [], steps: [], focus: false, status: "done", createdAt: 1, completedAt: Date.now() }],
      sessions: [{ id: "s1", areaId: "walking", date: new Date().toISOString().slice(0, 10), minutes: 35, n: 1, at: Date.now(), source: "manual" }],
    };
    const out = migrate(old);
    expect(out.history!.map((e) => `${e.kind}:${e.type}`).sort()).toEqual(["done:session", "done:task"]);
  });
});

describe("D. snapshots and reminders", () => {
  const d = sample();

  it("past weeks are saved as snapshots; Friday saves 'Week so far', Sunday 'Your week'", () => {
    const fri = snapshotsDue(d, FRI);
    expect(fri.map((w) => `${w.week}|${w.kind}`)).toEqual(expect.arrayContaining(["2026-10-05|your-week", "2026-10-12|week-so-far"]));
    expect(fri.find((w) => w.kind === "week-so-far")!.areas.find((a) => a.id === "job")).toMatchObject({ done: 0, target: 5 });
    const sun = snapshotsDue(d, SUN);
    const mine = sun.find((w) => w.week === WEEK && w.kind === "your-week")!;
    expect(mine.own).toMatchObject({ added: 5, finished: 4 });
    expect(mine.focus).toEqual(["job", "walking"]);
    // already saved: nothing more to save
    expect(snapshotsDue({ ...d, weeks: [...fri, ...sun] }, SUN)).toHaveLength(0);
  });

  it("Friday 21:00 and Sunday 21:00 notifications; times editable; switchable off", () => {
    const list = planNotifications(d, new Date(2026, 9, 14, 8, 0));
    const f = list.find((x) => x.key === "sofar:2026-10-16")!;
    const s = list.find((x) => x.key === "review:2026-10-18")!;
    expect([f.kind, f.at.getHours(), f.at.getMinutes()]).toEqual(["sofar", 21, 0]);
    expect([s.kind, s.at.getHours(), s.at.getMinutes()]).toEqual(["review", 21, 0]);
    const edited = planNotifications({ ...d, profile: { ...d.profile!, fridayReviewTime: "20:30" } }, new Date(2026, 9, 14, 8, 0));
    expect(edited.find((x) => x.key === "sofar:2026-10-16")!.at.getMinutes()).toBe(30);
    const off = planNotifications({ ...d, profile: { ...d.profile!, notify: { ...d.profile!.notify!, weekSoFar: false, review: false } } }, new Date(2026, 9, 14, 8, 0));
    expect(off.some((x) => x.kind === "sofar" || x.kind === "review")).toBe(false);
  });

  it("tapping them opens the right screen", () => {
    expect(resolveTap(d, { kind: "sofar", key: "sofar:2026-10-16" }, "2026-10-16", FRI)).toEqual({ k: "panel", panel: "sofar" });
    expect(resolveTap(d, { kind: "review", key: "review:2026-10-18" }, "2026-10-18", SUN)).toEqual({ k: "panel", panel: "review" });
  });
});

describe("D. Apply focus gives an area earlier days next week", () => {
  const NEXT = new Date(2026, 9, 19, 0, 0);
  const base = seedIfNeeded({ version: 2, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NEXT);
  const datesOf = (data: AppData) => planSessions(data, NEXT).filter((s) => s.areaId === "powerbi" && !s.done).map((s) => s.date);

  it("a focus area takes the earliest days of the week", () => {
    const plain = datesOf(base);
    const focused = datesOf({ ...base, settings: { ...base.settings, focus: { week: "2026-10-19", areas: ["powerbi"] } } });
    expect(plain).toHaveLength(4);
    expect(focused).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(focused[3] < plain[3]).toBe(true);
    // for another week the focus is ignored
    expect(datesOf({ ...base, settings: { ...base.settings, focus: { week: "2026-10-26", areas: ["powerbi"] } } })).toEqual(plain);
  });
});

describe("repeats in the store: undo, missed log", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    actions.replaceAll(seedIfNeeded({ version: 2, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, FRI));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("undoing 'Added' on a repeat removes the whole series, not just its first day", () => {
    const t = actions.addTask({ title: "Vitamin", due: "2026-10-16", dueTime: "11:00", timeSource: "typed", important: false, tags: [], recur: { freq: "daily", interval: 1 } });
    // (The life admin pack is in `series` too; this is about the one just added.)
    const mine = () => (getData().series ?? []).filter((s) => !s.lifeId);
    expect(mine()).toHaveLength(1);
    actions.undoAdd(t.id);
    expect(mine()).toHaveLength(0);
    expect(getData().occurrences ?? []).toHaveLength(0);
  });

  it("older missed days of a repeat are logged as missed (history), only the latest carries", () => {
    actions.addTask({ title: "Vitamin", due: "2026-10-12", dueTime: "11:00", timeSource: "typed", important: false, tags: [], recur: { freq: "daily", interval: 1 } });
    actions.sweep(new Date(2026, 9, 15, 9, 0));
    const missed = getData().history!.filter((e) => e.kind === "missed" && e.type === "task");
    expect(missed.map((e) => e.date).sort()).toEqual(["2026-10-12", "2026-10-13"]);
    expect(missed.every((e) => e.createdByMe && e.title === "Vitamin")).toBe(true);
  });
});
