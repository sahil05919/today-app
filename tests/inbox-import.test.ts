import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));

import { emptyData } from "../lib/backup";
import { findTodayCalendar } from "../lib/calendarNames";
import { inboxStatusLines } from "../lib/inbox";
import { importInbox, type InboxBridge } from "../lib/inboxRun";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import { syncSteps } from "../lib/syncSteps";
import { buildTimeline } from "../lib/timeline";
import type { AppData } from "../lib/types";

// Europe/London during BST (vitest pins TZ). 14 Oct 2026 is BST (UTC+1): 00:30 local is still 23:30 UTC on the 13th.
const JUST_AFTER_MIDNIGHT = new Date(2026, 9, 14, 0, 30);
const MORNING = new Date(2026, 9, 14, 8, 0);
const base = (): AppData => seedIfNeeded(emptyData(), MORNING);
const utcMidnight = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const allDay = (eventId: number, title: string, date: string, description = "", calendarId = 21) => ({ id: `${eventId}:1`, eventId, title, begin: utcMidnight(date), end: utcMidnight(date) + 86_400_000, allDay: true, calendarId, description });

const GOOGLE = { account: "me@gmail.com", accountType: "com.google", primary: false };
let raw: Array<Record<string, unknown>>;
let removed: number[];
let readCalls: Array<{ kind: string; id?: number; from: number; to: number }>;
const bridge = (over: Partial<InboxBridge> = {}): InboxBridge => ({
  access: async () => "granted",
  calendars: async () => [{ id: 1, name: "me@gmail.com", account: "me@gmail.com", accountType: "com.google", primary: true }, { id: 21, name: "Today – Inbox", ...GOOGLE }],
  read: async (id, from, to) => (readCalls.push({ kind: "one", id, from, to }), raw as never),
  readAll: async (from, to) => (readCalls.push({ kind: "all", from, to }), raw as never),
  remove: async (id) => (removed.push(id), true),
  ...over,
});

beforeEach(async () => {
  vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
  await whenLoaded();
  actions.replaceAll(base());
  removed = [];
  readCalls = [];
  raw = [];
});

describe("5. Gmail tasks: an all-day TASK: event dated today (London, BST) is imported", () => {
  it("is imported with source gmail-task, shows in today's to-do list, and the toast is queued", async () => {
    raw = [allDay(101, "TASK: Reply to Pinnacle about shift", "2026-10-14", "source: Shift on 24 Oct")];
    const r = await importInbox(MORNING, bridge(), true);
    expect(r).toMatchObject({ added: 1, status: "ok" });
    const t = getData().tasks.find((x) => x.title === "Reply to Pinnacle about shift")!;
    expect(t).toMatchObject({ due: "2026-10-14", src: "gmail-task" });
    // It is in "To-do today" (a flexible task on the timeline of 14 Oct)…
    const tl = buildTimeline(getData(), "2026-10-14", MORNING);
    expect([...tl.items, ...tl.overflow.map((o) => ({ taskId: o.task.id }))].some((i) => i.taskId === t.id)).toBe(true);
    // …and in "What the app did", and the "1 task added from Gmail" toast is waiting.
    expect(getData().auto).toMatchObject([{ src: "gmail-task", kind: "added", key: `task:${t.id}`, reviewed: false }]);
    expect(getData().settings.inboxAdded?.n).toBe(1);
    expect(removed).toEqual([101]);
  });

  it("the same at 00:30 BST, when the UTC date is still yesterday; and a task for yesterday and tomorrow keep their own days", async () => {
    raw = [allDay(1, "TASK: Today one", "2026-10-14"), allDay(2, "TASK: Yesterday one", "2026-10-13"), allDay(3, "TASK: Tomorrow one", "2026-10-15")];
    await importInbox(JUST_AFTER_MIDNIGHT, bridge(), true);
    expect(Object.fromEntries(getData().tasks.map((t) => [t.title, t.due]))).toMatchObject({ "Today one": "2026-10-14", "Yesterday one": "2026-10-13", "Tomorrow one": "2026-10-15" });
    // The read window starts 30 days back and reaches four months ahead from the start of the LOCAL day.
    const w = readCalls[0];
    const startOfDay = new Date(2026, 9, 14).getTime();
    expect(w.from).toBeLessThanOrEqual(startOfDay - 29 * 86_400_000);
    expect(w.to).toBeGreaterThanOrEqual(startOfDay + 100 * 86_400_000);
  });

  it("finds the calendar whatever the dash, case or spacing (an en dash, a hyphen, extra spaces)", () => {
    for (const name of ["Today – Inbox", "Today - Inbox", "today — inbox", "  TODAY   -  INBOX "]) {
      expect(findTodayCalendar([{ id: 5, name, ...GOOGLE }], "inbox").cal?.id, name).toBe(5);
    }
  });

  it("THE CAUSE: with only the read permission the phone could not list calendars; the import still works (stored id, then a search)", async () => {
    raw = [allDay(7, "TASK: Book dentist", "2026-10-14")];
    // 1. The list is refused, but the Inbox was found before: its id was kept.
    actions.setProfile({ ...base().profile!, inboxCalendarId: "21" });
    let r = await importInbox(MORNING, bridge({ calendars: async () => null }), true);
    expect(r.check).toMatchObject({ calendar: "found", found: 1, imported: 1 });
    expect(readCalls[0]).toMatchObject({ kind: "one", id: 21 });
    // 2. The list is refused and nothing was kept: every calendar is searched for TASK: events instead (and nothing is deleted).
    actions.replaceAll(base());
    removed = [];
    readCalls = [];
    r = await importInbox(MORNING, bridge({ calendars: async () => null }), true);
    expect(r.check).toMatchObject({ calendar: "scanned", found: 1, imported: 1 });
    expect(readCalls[0].kind).toBe("all");
    expect(getData().tasks.map((t) => t.title)).toContain("Book dentist");
    expect(removed).toEqual([]);
  });

  it("a calendar that is named differently is found by searching, once", async () => {
    raw = [allDay(8, "TASK: Renew passport", "2026-10-20", "", 33), allDay(9, "Dentist", "2026-10-20", "", 33)];
    const odd = bridge({ calendars: async () => [{ id: 33, name: "Gmail tasks", ...GOOGLE }] });
    const first = await importInbox(MORNING, odd, true);
    expect(first.check).toMatchObject({ calendar: "scanned", found: 1, imported: 1 });
    const second = await importInbox(MORNING, odd, true);
    expect(second.check).toMatchObject({ found: 1, imported: 0 });
    expect(getData().tasks.filter((t) => t.title === "Renew passport")).toHaveLength(1);
  });

  it("no permission is reported, not hidden; failing to delete is counted but the task is still imported once", async () => {
    let r = await importInbox(MORNING, bridge({ access: async () => "denied" }), true);
    expect(r.status).toBe("no-permission");
    expect(getData().settings.inboxCheck).toMatchObject({ status: "no-permission" });
    raw = [allDay(10, "TASK: Call bank", "2026-10-14")];
    const noDelete = bridge({ remove: async () => false });
    r = await importInbox(MORNING, noDelete, true);
    expect(r.check).toMatchObject({ imported: 1, removeFailed: 1 });
    r = await importInbox(MORNING, noDelete, true);
    expect(r.check).toMatchObject({ imported: 0, removeFailed: 1 });
    expect(getData().tasks.filter((t) => t.title === "Call bank")).toHaveLength(1);
  });

  it("it runs when the app opens AND when it comes back, after the calendar is read", () => {
    const steps = syncSteps();
    const inbox = steps.find((s) => s.name === "inbox")!;
    expect(inbox.reasons).toEqual(expect.arrayContaining(["open", "resume"]));
    expect(steps.findIndex((s) => s.name === "calendar-read")).toBeLessThan(steps.findIndex((s) => s.name === "inbox"));
  });

  it("the status line says when it last looked, whether the calendar was found, and what it found and imported", async () => {
    raw = [allDay(11, "TASK: A", "2026-10-14"), allDay(12, "TASK: B", "2026-10-14"), allDay(13, "DIGEST: 1 email needs you", "2026-10-14", "• x — y — z")];
    await importInbox(MORNING, bridge(), true);
    const lines = inboxStatusLines(getData().settings.inboxCheck);
    expect(lines[0]).toMatch(/^Last check \d\d:\d\d$/);
    expect(lines[1]).toBe("Calendar “Today – Inbox”: found");
    expect(lines[2]).toBe("TASK events found: 2 · imported now: 2 · digests: 1");
    expect(inboxStatusLines(undefined)[0]).toMatch(/Not checked yet/);
    expect(inboxStatusLines({ at: 1, status: "ok", calendar: "found", calendarName: "Today – Inbox", synced: false, found: 0, imported: 0, digests: 0, removeFailed: 0 })[1]).toMatch(/not syncing it/);
    expect(inboxStatusLines({ at: 1, status: "ok", calendar: "scanned", found: 0, imported: 0, digests: 0, removeFailed: 0 })[1]).toMatch(/searched all your calendars/);
  });
});
