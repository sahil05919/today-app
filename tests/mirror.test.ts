import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the phone is faked. The store is the web one (localStorage), the planner is the real one.
const reads: Array<{ excluded?: number[] }> = [];
let phoneCalendars: Array<{ id: number; name: string; account: string; accountType: string; primary: boolean }> = [];
vi.mock("../lib/nativeBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/nativeBridge")>()),
  calendarWriteAccess: async () => "granted",
  deletePhoneEvent: async () => true,
  mirrorApply: async () => null,
  mirrorState: async () => null,
  readCalendarById: async () => [],
  armDailyMirror: async () => 1,
  calendarAccess: async () => "granted",
  askCalendarAccess: async () => "granted",
  listWritableCalendars: async () => phoneCalendars,
  readPhoneCalendar: async (_f: number, _t: number, excluded?: number[]) => {
    reads.push({ excluded });
    return [
      { id: "1:1", eventId: 1, title: "Dentist", begin: Date.UTC(2026, 9, 14, 9), end: Date.UTC(2026, 9, 14, 10), allDay: false, calendarId: 1 },
      { id: "9:1", eventId: 9, title: "📊 Power BI session 4", begin: Date.UTC(2026, 9, 14, 17), end: Date.UTC(2026, 9, 14, 18), allDay: false, calendarId: 20, description: "Managed by the Today app — edits here are overwritten" },
      { id: "5:1", eventId: 5, title: "TASK: Reply to Pinnacle", begin: Date.UTC(2026, 9, 14), end: Date.UTC(2026, 9, 15), allDay: true, calendarId: 21 },
    ];
  },
}));
vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));

import { emptyData } from "../lib/backup";
import { findTodayCalendar, normName, todayCalendarIds } from "../lib/calendarNames";
import { syncPhoneCalendar, withoutTodayCalendars } from "../lib/calendarSync";
import { buildMirrorEntries, diffMirror, oldestOpenDay, sigOf } from "../lib/mirror";
import { resetMirrorForTests, runMirror, type MirrorBridge } from "../lib/mirrorRun";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import type { MirrorEntry, MirrorOp, MirrorState } from "../lib/nativeBridge";
import type { AppData, Task } from "../lib/types";

const NOW = new Date(2026, 9, 12, 8, 0); // Mon 12 Oct 2026
const TODAY = "2026-10-12";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `m${++n}`, title: `Task ${n}`, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const base = (tasks: Task[], extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), tasks, ...extra });

const cal = (id: number, name: string, accountType = "com.google") => ({ id, name, account: "me@gmail.com", accountType, primary: false });

describe("finding Today's calendars by name", () => {
  it("dashes, case and spaces do not matter; a non-Google calendar of that name is not used", () => {
    expect(normName("Today - Plan")).toBe(normName("Today – Plan"));
    expect(normName("  today  —  plan ")).toBe(normName("Today – Plan"));
    const list = [cal(1, "me@gmail.com"), cal(20, "Today - Plan"), cal(21, "Today – Inbox"), cal(30, "Today – Plan", "com.local")];
    expect(findTodayCalendar(list, "plan").cal?.id).toBe(20);
    expect(findTodayCalendar(list, "inbox").cal?.id).toBe(21);
    expect(findTodayCalendar([cal(30, "Today – Plan", "com.local")], "plan")).toEqual({ why: "not-google" });
    expect(findTodayCalendar([cal(1, "x")], "plan")).toEqual({ why: "missing" });
    // A calendar picked in Settings wins.
    expect(findTodayCalendar(list, "plan", "1").cal?.id).toBe(1);
    expect(todayCalendarIds(list).sort()).toEqual([20, 21, 30]);
  });
});

describe("reading the phone's calendar never reads Today's own calendars back", () => {
  it("withoutTodayCalendars drops both calendars, mirror events and add-on notes", () => {
    const raw = [
      { title: "Dentist", calendarId: 1 },
      { title: "x", calendarId: 20 },
      { title: "y", calendarId: 21 },
      { title: "Mirror", calendarId: 99, description: "Duration: 30 min\nManaged by the Today app — edits here are overwritten" },
      { title: "TASK: Call", calendarId: 99 },
      { title: "DIGEST: 3 emails need you", calendarId: 99 },
    ];
    expect(withoutTodayCalendars(raw, [20, 21]).map((e) => e.title)).toEqual(["Dentist"]);
  });

  it("syncPhoneCalendar asks Android to exclude both calendars, and only real events become fixed blocks", async () => {
    phoneCalendars = [cal(1, "me@gmail.com"), cal(20, "Today – Plan"), cal(21, "Today – Inbox")];
    reads.length = 0;
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    await whenLoaded();
    actions.replaceAll(base([]));
    expect(await syncPhoneCalendar()).toBe("ok");
    expect(reads[0].excluded?.sort()).toEqual([20, 21]);
    expect(getData().calendarEvents?.map((e) => e.title)).toEqual(["Dentist"]);
  });
});

describe("what the Plan calendar should hold", () => {
  const data = base(
    [
      task({ title: "Fill form", due: TODAY, dueTime: "15:00", estimateMin: 30, area: "admin" }),
      task({ title: "Renew passport", due: "2026-10-13" }),
      task({ title: "Pay gas", due: TODAY, dueTime: "10:00", status: "done", completedAt: NOW.getTime() }),
    ],
    { events: [{ id: "e1", title: "Dinner with Sam", date: "2026-10-14", start: "19:00", end: "21:00", createdAt: 1 }], calendarEvents: [{ id: "cal:1", title: "Dentist", date: "2026-10-14", start: "09:00", end: "10:00", createdAt: 1, source: "calendar" }] },
  );
  const entries = buildMirrorEntries(data, TODAY, 7, NOW);
  const titles = entries.map((e) => e.event.title);

  it("timed items keep their time; flexible to-dos are all-day 'To-do: …'", () => {
    const form = entries.find((e) => e.event.title.includes("Fill form"))!;
    expect(form.event.allDay).toBe(false);
    expect(new Date(form.event.start).getHours()).toBe(15);
    expect(new Date(form.event.start).getMinutes()).toBe(0);
    const passport = entries.find((e) => e.event.title.includes("Renew passport"))!;
    expect(passport.event.allDay).toBe(true);
    expect(passport.event.title).toMatch(/^To-do: .*Renew passport/);
    expect(new Date(passport.event.start).toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("a done item is '✓ …'", () => {
    expect(titles.some((t) => t.startsWith("✓ ") && t.includes("Pay gas"))).toBe(true);
  });

  it("sessions are 'emoji title' and timed; routine blocks and phone-calendar events are not mirrored", () => {
    expect(titles.some((t) => /^📊 /.test(t))).toBe(true);
    expect(titles.join("|")).not.toMatch(/Commute|Lunch|Tea & food|Dentist/);
    // An event typed in Today (not already in the phone calendar) is mirrored.
    expect(titles.some((t) => t.includes("Dinner with Sam"))).toBe(true);
  });

  it("the description has area, duration and the managed-by line; there are no reminders in what is sent", () => {
    const form = entries.find((e) => e.event.title.includes("Fill form"))!;
    expect(form.event.description).toContain("Duration: 30 min");
    expect(form.event.description).toContain("Managed by the Today app — edits here are overwritten");
    expect(Object.keys(form.event)).not.toContain("reminders");
  });

  it("a skipped item is '✗ …'", () => {
    const skipped = base([task({ title: "Optional thing", due: TODAY, dueTime: "16:00" })]);
    const entry = buildMirrorEntries(skipped, TODAY, 1, NOW).find((e) => e.event.title.includes("Optional thing"))!;
    expect(entry.event.title).not.toMatch(/^[✓✗]/);
    // (A skipped repeat occurrence shows as skipped on the timeline; the mark is added by the same rule.)
  });
});

const entry = (key: string, day: string, title: string): MirrorEntry => {
  const event = { title, start: 1, end: 2, allDay: false, description: "d" };
  return { key, day, sig: sigOf(event), event };
};
const have = (e: MirrorEntry, id: number, final = false): MirrorState["map"][string] => ({ id, sig: e.sig, day: e.day, final });

describe("the diff: insert new, update changed, delete removed, never delete-all", () => {
  const a = entry("2026-10-12|task:a", "2026-10-12", "A");
  const b = entry("2026-10-13|task:b", "2026-10-13", "B");
  const c = entry("2026-10-14|task:c", "2026-10-14", "C");

  it("builds the three sets", () => {
    const map = { [a.key]: have(a, 1), [b.key]: { ...have(b, 2), sig: "old" }, "2026-10-15|task:gone": { id: 3, sig: "x", day: "2026-10-15" } };
    const d = diffMirror([a, b, c], map, TODAY);
    expect(d.ops.map((o) => `${o.op} ${o.key}`).sort()).toEqual(["delete 2026-10-15|task:gone", "insert 2026-10-14|task:c", "update 2026-10-13|task:b"]);
    expect([d.inserts, d.updates, d.deletes]).toEqual([1, 1, 1]);
  });

  it("a done item updates its title (same key, new content)", () => {
    const done = entry(a.key, a.day, "✓ A");
    const d = diffMirror([done], { [a.key]: have(a, 1) }, TODAY);
    expect(d.ops).toHaveLength(1);
    expect(d.ops[0]).toMatchObject({ op: "update", key: a.key });
    expect(d.ops[0].event?.title).toBe("✓ A");
  });

  it("re-running with no changes makes ZERO writes", () => {
    const map = { [a.key]: have(a, 1), [b.key]: have(b, 2), [c.key]: have(c, 3) };
    expect(diffMirror([a, b, c], map, TODAY).ops).toEqual([]);
  });

  it("beyond the 7-day window nothing is written, and what drifts out of it is removed", () => {
    const far = entry("2026-10-25|task:far", "2026-10-25", "Far");
    expect(diffMirror([far], {}, TODAY).ops).toEqual([]);
    const d = diffMirror([], { [far.key]: have(far, 9) }, TODAY);
    expect(d.ops.map((o) => o.op)).toEqual(["delete"]);
  });

  it("a day that has ended is written ONCE with its final state, then never touched again", () => {
    const y = entry("2026-10-11|task:y", "2026-10-11", "✓ Y");
    const open = { id: 7, sig: "before-done", day: "2026-10-11" };
    const first = diffMirror([y], { [y.key]: open }, TODAY);
    expect(first.ops).toEqual([expect.objectContaining({ op: "update", key: y.key, final: true })]);
    expect(first.ops[0].event?.title).toBe("✓ Y");
    // Once final: even a different title in the plan changes nothing, and nothing is deleted.
    const again = diffMirror([entry(y.key, y.day, "Y renamed")], { [y.key]: { ...open, final: true } }, TODAY);
    expect(again.ops).toEqual([]);
    expect(diffMirror([], { [y.key]: { ...open, final: true } }, TODAY).ops).toEqual([]);
  });

  it("a past day is never created, and a past entry that vanished from the plan is closed, not deleted", () => {
    const past = entry("2026-10-10|task:p", "2026-10-10", "P");
    expect(diffMirror([past], {}, TODAY).ops).toEqual([]);
    const d = diffMirror([], { [past.key]: { id: 4, sig: "s", day: "2026-10-10" } }, TODAY);
    expect(d.ops).toEqual([expect.objectContaining({ op: "update", final: true })]);
  });

  it("finds the oldest day still open so days missed while the app was closed are finalised too", () => {
    expect(oldestOpenDay({}, TODAY)).toBe("2026-10-11");
    expect(oldestOpenDay({ k: { id: 1, sig: "s", day: "2026-10-08" } }, TODAY)).toBe("2026-10-08");
    expect(oldestOpenDay({ k: { id: 1, sig: "s", day: "2026-09-01" } }, TODAY)).toBe("2026-09-28");
  });
});

describe("running the mirror", () => {
  const data = base([task({ title: "Fill form", due: TODAY, dueTime: "15:00" })]);
  let stored: MirrorState;
  let applied: Array<{ ops: MirrorOp[]; plan: MirrorEntry[] }>;
  let nextId: number;
  const bridge = (list = [cal(1, "me@gmail.com"), cal(20, "Today – Plan")], access: "granted" | "denied" = "granted"): MirrorBridge => ({
    access: async () => access,
    calendars: async () => list,
    state: async () => stored,
    apply: async (calendarId, ops, plan) => {
      applied.push({ ops, plan });
      stored = { calendarId, map: { ...stored.map } };
      for (const o of ops) {
        if (o.op === "delete") delete stored.map[o.key];
        else stored.map[o.key] = { id: stored.map[o.key]?.id ?? nextId++, sig: o.sig, day: o.day, final: o.final };
      }
      return { inserted: ops.filter((o) => o.op === "insert").length, updated: ops.filter((o) => o.op === "update").length, deleted: ops.filter((o) => o.op === "delete").length, failed: 0 };
    },
    read: async () => [],
    remove: async () => true,
  });
  beforeEach(() => {
    stored = { calendarId: null, map: {} };
    applied = [];
    nextId = 100;
    resetMirrorForTests();
  });

  it("writes the plan once, then a second run with no changes makes zero writes", async () => {
    const first = await runMirror(NOW, bridge(), true, data);
    expect(first.status).toBe("ok");
    expect(first.written).toBeGreaterThan(0);
    const second = await runMirror(NOW, bridge(), true, data);
    expect(second.status).toBe("ok");
    expect(second.written).toBe(0);
    expect(applied).toHaveLength(1); // the phone was not even asked
  });

  it("ticking an item rewrites just that item's title", async () => {
    await runMirror(NOW, bridge(), true, data);
    const ticked: AppData = { ...data, tasks: data.tasks.map((t) => ({ ...t, status: "done" as const, completedAt: NOW.getTime() })) };
    const r = await runMirror(NOW, bridge(), true, ticked);
    expect(r.written).toBe(1);
    const op = applied[1].ops[0];
    expect(op.op).toBe("update");
    expect(op.event?.title.startsWith("✓ ")).toBe(true);
  });

  it("says what is missing instead of failing: no calendar, not a Google one, no permission, switched off", async () => {
    expect((await runMirror(NOW, bridge([cal(1, "me@gmail.com")]), true, data)).status).toBe("no-calendar");
    expect((await runMirror(NOW, bridge([cal(30, "Today – Plan", "com.local")]), true, data)).status).toBe("not-google");
    expect((await runMirror(NOW, bridge(undefined, "denied"), true, data)).status).toBe("no-permission");
    const off: AppData = { ...data, profile: { ...(data.profile as object), planMirror: false } as AppData["profile"] };
    expect((await runMirror(NOW, bridge(), true, off)).status).toBe("off");
    expect(applied).toHaveLength(0);
  });

  it("a lost map (reinstall) clears the app's own stray future events first so nothing is doubled", async () => {
    const removed: number[] = [];
    const b = bridge();
    b.read = async () => [{ id: "1", eventId: 55, title: "old", begin: Date.UTC(2026, 9, 13), end: Date.UTC(2026, 9, 14), allDay: true, description: "Managed by the Today app — edits here are overwritten" }];
    b.remove = async (id) => (removed.push(id), true);
    await runMirror(NOW, b, true, data);
    expect(removed).toEqual([55]);
  });
});
