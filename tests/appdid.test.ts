import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));

import { emptyData } from "../lib/backup";
import { autoRows, carriedBetween, chipCount, checkinLine, dueChanges, lifeAdminToday, newCalendarEntries, rowText } from "../lib/autoLog";
import { digestKey } from "../lib/inbox";
import { importInbox, type InboxBridge } from "../lib/inboxRun";
import { planNotifications } from "../lib/notifications/plan";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import { eventSource } from "../lib/entries";
import type { AppData, FixedEvent, Task } from "../lib/types";

const NOW = new Date(2026, 9, 14, 9, 0); // Wed 14 Oct 2026 (BST)
const TODAY = "2026-10-14";
let n = 0;
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });
const task = (o: Partial<Task>): Task => ({ id: `t${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const cap = (title: string, extra: object = {}) => ({ title, important: false, tags: [] as string[], ...extra });
const calEvent = (id: string, title: string, date: string, extra: Partial<FixedEvent> = {}): FixedEvent => ({ id: `cal:${id}:${date}`, calId: id, title, date, start: "10:00", end: "11:00", createdAt: 1, source: "calendar", ...extra });

beforeEach(async () => {
  vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
  await whenLoaded();
  actions.replaceAll(base());
});

describe("3. every source is tagged where the item is made", () => {
  let raw: Array<Record<string, unknown>>;
  const bridge = (): InboxBridge => ({
    access: async () => "granted",
    calendars: async () => [{ id: 21, name: "Today – Inbox", account: "me@gmail.com", accountType: "com.google", primary: false }],
    read: async () => raw as never,
    remove: async () => true,
  });
  const allDay = (eventId: number, title: string, date: string, description = "") => ({ id: `${eventId}:1`, eventId, title, begin: Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)), end: Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + 86_400_000, allDay: true, calendarId: 21, description });

  it("a Gmail TASK: is gmail-task by default, and the script can say star / shift / interview / bill / booking", async () => {
    raw = [
      allDay(1, "TASK: Reply to Pinnacle", TODAY),
      allDay(2, "TASK: Starred: invoice question", TODAY, "kind: star"),
      allDay(3, "TASK: Confirm Tuesday shift", TODAY, "kind: shift"),
      allDay(4, "TASK: Prepare for interview", TODAY, "kind: interview"),
      allDay(5, "TASK: Pay council tax", TODAY, "kind: bill"),
      allDay(6, "TASK: Hotel check-in", TODAY, "kind: booking"),
      allDay(7, "TASK: Something odd", TODAY, "kind: nonsense"),
    ];
    await importInbox(NOW, bridge(), true);
    const tasks = getData().tasks;
    expect(tasks.find((t) => t.title === "Reply to Pinnacle")!.src).toBe("gmail-task");
    expect(Object.fromEntries(tasks.map((t) => [t.title, t.src]))).toMatchObject({
      "Starred: invoice question": "gmail-star",
      "Confirm Tuesday shift": "gmail-shift",
      "Prepare for interview": "gmail-interview",
      "Pay council tax": "gmail-bill",
      "Hotel check-in": "gmail-booking",
      "Something odd": "gmail-task",
    });
    expect(getData().auto).toHaveLength(7);
    expect(getData().auto!.every((e) => e.kind === "added" && !e.reviewed && e.key.startsWith("task:"))).toBe(true);
    // The same events again: nothing new.
    await importInbox(NOW, bridge(), true);
    expect(getData().auto).toHaveLength(7);
  });

  it("a Gmail DIGEST: is listed once", async () => {
    raw = [allDay(9, "DIGEST: 2 emails need you", TODAY, "• A — B — c\n• D — E — f")];
    await importInbox(NOW, bridge(), true);
    await importInbox(NOW, bridge(), true);
    const d = getData().auto!.filter((e) => e.src === "gmail-digest");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ title: "2 emails need you" });
    expect(d[0].key.startsWith(`digest:${TODAY}|2|`)).toBe(true);
    // A later digest the same day (the script ran again with a new email) is a second entry.
    raw = [allDay(9, "DIGEST: 3 emails need you", TODAY, "• A — B — c\n• D — E — f\n• G — H — i")];
    await importInbox(NOW, bridge(), true);
    expect(getData().auto!.filter((e) => e.src === "gmail-digest")).toHaveLength(2);
  });

  it("new phone-calendar events are listed (the first read only learns), #today-remind ones are labelled", () => {
    const first = [calEvent("1", "Old standing meeting", "2026-10-15")];
    actions.setCalendarEvents(first);
    expect(getData().auto ?? []).toHaveLength(0);
    expect(getData().settings.calSeen).toEqual(["1@2026-10-15"]);
    actions.setCalendarEvents([...first, calEvent("2", "Dentist", "2026-10-16"), calEvent("3", "WTM shift", "2026-10-17", { remind: true, shift: true }), calEvent("4", "Table booking", "2026-10-18", { remind: true }), calEvent("5", "Last year", "2025-01-01")]);
    expect(getData().auto!.map((e) => [e.title, e.src])).toEqual([["Dentist", "phone-calendar"], ["WTM shift", "gmail-shift"], ["Table booking", "gmail-booking"]]);
    // Seen again: nothing new.
    actions.setCalendarEvents(getData().calendarEvents!);
    expect(getData().auto).toHaveLength(3);
    expect(eventSource(calEvent("6", "x", TODAY, { remind: true, title: "Interview with ACME" }))).toBe("gmail-interview");
    expect(eventSource(calEvent("7", "x", TODAY))).toBe("phone-calendar");
  });

  it("planner moves: only the app's own, one group per re-plan; moves you choose yourself are not listed", () => {
    actions.replaceAll(base({ tasks: [task({ id: "a", title: "Call bank", due: TODAY }), task({ id: "b", title: "Book dentist", due: TODAY }), task({ id: "c", title: "Mine", due: TODAY })] }));
    actions.moveTasks([{ taskId: "a", to: "2026-10-15" }, { taskId: "b", to: "2026-10-15", time: "10:00" }], { group: "replan:1" });
    actions.moveTasks([{ taskId: "c", to: "2026-10-16" }]); // an ordinary move (you chose it)
    const auto = getData().auto!;
    expect(auto.map((e) => [e.key, e.src, e.kind, e.group])).toEqual([["task:a", "planner-move", "moved", "replan:1"], ["task:b", "planner-move", "moved", "replan:1"]]);
    expect(auto[0]).toMatchObject({ from: { date: TODAY }, to: { date: "2026-10-15" } });
  });

  it("life admin that is on today is listed once; your own repeats are not", () => {
    const withLife = seedIfNeeded(emptyData(), new Date(2026, 9, 12)); // Mon: "Side work check"
    actions.replaceAll({ ...withLife, series: [...(withLife.series ?? []), { id: "mine", title: "Water the plants", tags: [], important: false, steps: [], rule: { freq: "daily", interval: 1 }, startDate: "2026-10-01", createdAt: 1 }] });
    actions.scanLifeAdmin("2026-10-14"); // Wednesday: Laundry
    actions.scanLifeAdmin("2026-10-14");
    const a = getData().auto!;
    expect(a.map((e) => [e.title, e.src])).toEqual([["Laundry", "life-admin"]]);
    expect(lifeAdminToday(getData(), "2026-10-14")).toHaveLength(1);
  });

  it("a missed session carried over by the planner is listed; things you type never are", () => {
    const before = base();
    const after = { ...before, tasks: [task({ id: "k", title: "Power BI session 3", due: TODAY, origin: { kind: "session", key: "session:powerbi:2026-10-13", date: "2026-10-13", areaId: "powerbi", carried: true } })] };
    expect(carriedBetween(before, after, "sweep:1")).toMatchObject([{ src: "planner-move", kind: "moved", key: "task:k" }]);
    // Typed by you: a task, an event, a repeat.
    actions.addTask(cap("Buy milk", { due: TODAY }));
    actions.addTask(cap("Water plants", { due: TODAY, recur: { freq: "daily", interval: 1 } }));
    actions.addEvent({ ...cap("Dinner with Sam", { due: TODAY }), kind: "event", event: { start: "19:00", end: "21:00" } });
    expect(getData().auto ?? []).toHaveLength(0);
    expect(chipCount(getData(), NOW)).toBe(0);
  });
});

describe("3. the home chip, the sheet and the check-in", () => {
  const entry = (id: string, at: number, extra = {}) => ({ id, at, src: "gmail-task" as const, kind: "added" as const, key: `task:${id}`, title: id, reviewed: false, ...extra });
  const DAY = 86_400_000;
  const nowMs = NOW.getTime();

  it("the chip counts unreviewed entries from the last 3 days only; a re-plan counts once", () => {
    const d = base({
      auto: [
        entry("a", nowMs - 1000),
        entry("b", nowMs - 2 * DAY),
        entry("old", nowMs - 4 * DAY), // too old for the chip
        entry("seen", nowMs - 1000, { reviewed: true }),
        entry("gone", nowMs - 1000, { removed: true }),
        { ...entry("m1", nowMs - 500), src: "planner-move" as const, kind: "moved" as const, group: "g1" },
        { ...entry("m2", nowMs - 400), src: "planner-move" as const, kind: "moved" as const, group: "g1" },
        { ...entry("m3", nowMs - 300), src: "planner-move" as const, kind: "moved" as const, group: "g1" },
      ],
    });
    expect(chipCount(d, NOW)).toBe(3); // a, b, and the re-plan
    expect(autoRows(d, NOW).find((r) => r.folded)).toMatchObject({ group: "planner" });
    expect(rowText(autoRows(d, NOW).find((r) => r.folded)!)).toBe("Re-planned: moved 3 items");
  });

  it("the sheet drops entries older than 7 days (they stay in the list) and groups by where they came from", () => {
    const d = base({ auto: [entry("new", nowMs), entry("week", nowMs - 6 * DAY), entry("older", nowMs - 8 * DAY)] });
    expect(autoRows(d, NOW).map((r) => r.entries[0].id)).toEqual(["new", "week"]);
    expect(d.auto).toHaveLength(3);
    expect(autoRows(base({ auto: [entry("c", nowMs), { ...entry("d", nowMs), src: "phone-calendar" as const }, { ...entry("e", nowMs), src: "life-admin" as const }] }), NOW).map((r) => r.group).sort()).toEqual(["calendar", "gmail", "life"]);
  });

  it("Seen ✓ and Mark all seen clear the chip; the entries stay", () => {
    actions.replaceAll(base({ auto: [entry("a", nowMs), entry("b", nowMs)] }));
    actions.seeAuto(["a"]);
    expect(chipCount(getData(), NOW)).toBe(1);
    actions.seeAllAuto(NOW);
    expect(chipCount(getData(), NOW)).toBe(0);
    expect(getData().auto).toHaveLength(2);
    expect(getData().auto!.every((e) => e.reviewed && !e.removed)).toBe(true);
  });

  it("Remove deletes an added task (Undo brings it back) and marks the entry", () => {
    actions.replaceAll(base({ tasks: [task({ id: "g", title: "Reply to Pinnacle", due: TODAY })], auto: [entry("g", nowMs)] }));
    const undo = actions.removeAuto(["g"])!;
    expect(getData().tasks.find((t) => t.id === "g")).toBeUndefined();
    expect(getData().auto![0]).toMatchObject({ removed: true, reviewed: true });
    expect(chipCount(getData(), NOW)).toBe(0);
    undo();
    expect(getData().tasks.find((t) => t.id === "g")?.title).toBe("Reply to Pinnacle");
    expect(getData().auto![0].removed).toBeUndefined();
    expect(chipCount(getData(), NOW)).toBe(1);
  });

  it("Remove on a calendar event hides it here; on the digest dismisses it", () => {
    const ev = calEvent("9", "Dentist", "2026-10-16");
    actions.replaceAll(base({ calendarEvents: [ev], settings: { ...base().settings, digest: { date: TODAY, title: "2 emails need you", items: ["a", "b"] } }, auto: [{ ...entry("ev", nowMs), src: "phone-calendar" as const, key: "event:9@2026-10-16" }, { ...entry("dg", nowMs), src: "gmail-digest" as const, key: `digest:${digestKey({ date: TODAY, title: "2 emails need you", items: ["a", "b"] })}` }] }));
    actions.removeAuto(["ev"]);
    expect(getData().eventMarks?.["9@2026-10-16"]?.hidden).toBe(true);
    actions.removeAuto(["dg"]);
    expect(getData().settings.digestDismissed).toBe(digestKey({ date: TODAY, title: "2 emails need you", items: ["a", "b"] }));
  });

  it("Undo move puts the item back, unless it has moved again", () => {
    actions.replaceAll(base({ tasks: [task({ id: "a", title: "Call bank", due: TODAY, dueTime: "18:00" })] }));
    actions.moveTasks([{ taskId: "a", to: "2026-10-15", time: "10:00" }], { group: "r1" });
    const id = getData().auto![0].id;
    const redo = actions.undoAutoMoves([id])!;
    expect(getData().tasks[0]).toMatchObject({ due: TODAY, dueTime: "18:00" });
    expect(getData().auto![0].removed).toBe(true);
    redo();
    expect(getData().tasks[0]).toMatchObject({ due: "2026-10-15", dueTime: "10:00" });
    // moved again by you since: leave it
    actions.setDue("a", "2026-10-20");
    expect(actions.undoAutoMoves([id])).toBeNull();
    expect(getData().tasks[0].due).toBe("2026-10-20");
  });

  it("the 20:00 check-in gains one line when something was added today and not seen, and no new notification is made", () => {
    const quiet = planNotifications(base(), NOW).filter((x) => x.kind === "tonight");
    const d = base({ auto: [entry("a", nowMs), entry("b", nowMs), entry("c", nowMs)] });
    const loud = planNotifications(d, NOW).filter((x) => x.kind === "tonight");
    expect(loud.length).toBe(quiet.length);
    expect(loud.find((x) => x.key === `tonight:${TODAY}`)?.body).toMatch(/ The app added 3 things today — have a look\.$/);
    expect(quiet.find((x) => x.key === `tonight:${TODAY}`)?.body).not.toMatch(/The app added/);
    expect(checkinLine(base({ auto: [entry("a", nowMs, { reviewed: true })] }), TODAY)).toBeNull();
    expect(checkinLine(base({ auto: [entry("a", nowMs - DAY)] }), TODAY)).toBeNull();
    expect(checkinLine(base({ auto: [entry("a", nowMs)] }), TODAY)).toBe("The app added 1 thing today — have a look.");
  });
});

describe("3. pure helpers", () => {
  it("dueChanges sees tasks and repeat days that moved", () => {
    const a = base({ tasks: [task({ id: "x", title: "X", due: TODAY })] });
    const b = { ...a, tasks: [{ ...a.tasks[0], due: "2026-10-16" }] };
    expect(dueChanges(a, b)).toEqual([{ key: "task:x", title: "X", from: { date: TODAY, time: undefined }, to: { date: "2026-10-16", time: undefined } }]);
    expect(dueChanges(a, a)).toEqual([]);
  });

  it("the first calendar read only learns what is there", () => {
    expect(newCalendarEntries(undefined, [calEvent("1", "A", "2026-10-15")], TODAY).entries).toEqual([]);
    expect(newCalendarEntries([], [calEvent("1", "A", "2026-10-15")], TODAY).entries).toHaveLength(1);
  });
});
