import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));

import { emptyData } from "../lib/backup";
import { convertCalendarEvents } from "../lib/calendar";
import { addedLine, digestCard, digestLine, noteFields, parseDigest, parseTaskEvent, todaysDigest } from "../lib/inbox";
import { importInbox, type InboxBridge } from "../lib/inboxRun";
import { planNotifications } from "../lib/notifications/plan";
import { remindClashes } from "../lib/remindClash";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import type { AppData } from "../lib/types";

const NOW = new Date(2026, 9, 12, 8, 0); // Mon 12 Oct 2026
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });

describe("TASK: events", () => {
  const d = base();
  it("with all the fields", () => {
    const t = parseTaskEvent(
      { eventId: 7, title: "TASK: Reply to Pinnacle about shift", date: "2026-10-14", description: "area: Job\ntime: 14:00\nduration: 20\nimportant: yes\nsource: Re: Shift on 24 Oct" },
      d,
    )!;
    expect(t).toMatchObject({ eventId: 7, title: "Reply to Pinnacle about shift", due: "2026-10-14", time: "14:00", duration: 20, important: true, source: "Re: Shift on 24 Oct" });
    // "Job" is one of the areas when it exists; otherwise the classifier decides (undefined here is fine either way).
    expect(["job", undefined]).toContain(t.area);
  });

  it("with none: only the title and the date", () => {
    const t = parseTaskEvent({ eventId: 8, title: "TASK: Book dentist", date: "2026-10-15" }, d)!;
    expect(t).toEqual({ eventId: 8, title: "Book dentist", due: "2026-10-15", area: undefined, time: undefined, duration: undefined, important: false, source: undefined });
  });

  it("is forgiving about case, spaces and junk values; an unknown area is left to the classifier", () => {
    const t = parseTaskEvent({ eventId: 9, title: "task:  Pay invoice ", date: "2026-10-15", description: "Area: Nonsense\nTime: 25:99\nDuration: lots\nImportant: no" }, d)!;
    expect(t).toMatchObject({ title: "Pay invoice", area: undefined, time: undefined, duration: undefined, important: false });
    expect(noteFields("a: 1\nnot a field\nB c: two")).toEqual({ a: "1", "b c": "two" });
  });

  it("is not a task without the prefix or without a title", () => {
    expect(parseTaskEvent({ eventId: 1, title: "Dentist", date: "2026-10-15" }, d)).toBeNull();
    expect(parseTaskEvent({ eventId: 1, title: "TASK:   ", date: "2026-10-15" }, d)).toBeNull();
  });
});

describe("DIGEST: events", () => {
  const ev = (date: string, description: string, title = "DIGEST: 3 emails need you") => ({ eventId: 1, title, date, description });
  const text = "• Pinnacle — Shift on 24 Oct — needs a reply\n• HMRC — Tax code — read\n- Sam — Dinner? — answer";

  it("parses one email per line", () => {
    expect(parseDigest(ev("2026-10-12", text))).toEqual({
      date: "2026-10-12",
      title: "3 emails need you",
      items: ["Pinnacle — Shift on 24 Oct — needs a reply", "HMRC — Tax code — read", "Sam — Dinner? — answer"],
    });
    expect(parseDigest({ eventId: 1, title: "Dentist", date: "2026-10-12" })).toBeNull();
  });

  it("only today's digest counts", () => {
    expect(todaysDigest([ev("2026-10-11", text), ev("2026-10-13", text)], "2026-10-12")).toBeNull();
    expect(todaysDigest([ev("2026-10-11", "• old"), ev("2026-10-12", text)], "2026-10-12")?.items).toHaveLength(3);
  });

  it("the card shows from 19:00 only, until dismissed, only for today; the evening check-in mentions it", () => {
    const withDigest = base({ settings: { ...base().settings, digest: parseDigest(ev("2026-10-12", text))! } });
    expect(digestCard(withDigest, new Date(2026, 9, 12, 18, 59))).toBeNull();
    expect(digestCard(withDigest, new Date(2026, 9, 12, 19, 0))?.items).toHaveLength(3);
    expect(digestCard(withDigest, new Date(2026, 9, 13, 19, 30))).toBeNull(); // yesterday's digest is not shown tomorrow
    const dismissed = { ...withDigest, settings: { ...withDigest.settings, digestDismissed: "2026-10-12" } };
    expect(digestCard(dismissed, new Date(2026, 9, 12, 20, 0))).toBeNull();
    expect(digestLine(withDigest, "2026-10-12")).toBe("3 emails need you");
    const tonight = planNotifications(withDigest, NOW).find((n) => n.kind === "tonight" && n.key === "tonight:2026-10-12");
    expect(tonight?.body).toMatch(/3 emails need you\.$/);
    // …and without a digest it is the usual nudge.
    expect(planNotifications(base(), NOW).find((n) => n.key === "tonight:2026-10-12")?.body).toMatch(/Anything from email to add\?$/);
  });
});

describe("importing from Today – Inbox", () => {
  let removed: number[];
  let raw: Array<Record<string, unknown>>;
  const bridge = (): InboxBridge => ({
    access: async () => "granted",
    calendars: async () => [
      { id: 1, name: "me@gmail.com", account: "me@gmail.com", accountType: "com.google", primary: true },
      { id: 21, name: "Today – Inbox", account: "me@gmail.com", accountType: "com.google", primary: false },
    ],
    read: async () => raw as never,
    remove: async (id) => (removed.push(id), true),
  });
  const allDay = (eventId: number, title: string, date: string, description = "") => ({ id: `${eventId}:1`, eventId, title, begin: Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)), end: Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + 86_400_000, allDay: true, calendarId: 21, description });

  beforeEach(async () => {
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    await whenLoaded();
    actions.replaceAll(base());
    removed = [];
    raw = [
      allDay(101, "TASK: Reply to Pinnacle about shift", "2026-10-14", "area: Job\ntime: 14:00\nduration: 20\nimportant: yes\nsource: Shift on 24 Oct"),
      allDay(102, "DIGEST: 2 emails need you", "2026-10-12", "• A — B — c\n• D — E — f"),
    ];
  });

  it("each TASK becomes ONE normal task, the event is deleted from the Inbox, and running again adds nothing", async () => {
    const r = await importInbox(NOW, bridge(), true);
    expect(r).toMatchObject({ added: 1, digest: true, status: "ok" });
    const mine = getData().tasks.filter((t) => t.title === "Reply to Pinnacle about shift");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ due: "2026-10-14", dueTime: "14:00", estimateMin: 20, important: true });
    expect(mine[0].notes).toContain("Shift on 24 Oct");
    expect(removed).toEqual([101]); // the DIGEST (102) is never deleted
    expect(getData().settings.inboxAdded?.n).toBe(1);
    expect(addedLine(1)).toBe("1 task added from Gmail");
    // The same event shows up again (the delete had not synced yet): still ONE task.
    const again = await importInbox(NOW, bridge(), true);
    expect(again.added).toBe(0);
    expect(getData().tasks.filter((t) => t.title === "Reply to Pinnacle about shift")).toHaveLength(1);
  });

  it("today's digest is stored for the card; a different day's is ignored; an old one is cleared", async () => {
    await importInbox(NOW, bridge(), true);
    expect(getData().settings.digest?.items).toHaveLength(2);
    raw = [allDay(103, "DIGEST: 5 emails need you", "2026-10-13", "• x")];
    await importInbox(NOW, bridge(), true);
    expect(getData().settings.digest).toBeUndefined();
  });

  it("with no Inbox calendar it says so and changes nothing", async () => {
    const b = bridge();
    b.calendars = async () => [];
    expect((await importInbox(NOW, b, true)).status).toBe("no-calendar");
    expect(getData().tasks.some((t) => t.title.includes("Pinnacle"))).toBe(false);
  });
});

describe("#today-remind events in the main calendar", () => {
  // Thu 15 Oct 2026, 08:00–16:00: inside work hours (Mon–Fri 09:00–17:00 by default).
  const shift = { id: "9:1", eventId: 9, title: "WTM Exhibition shift (Pinnacle)", begin: new Date(2026, 9, 15, 10, 0).getTime(), end: new Date(2026, 9, 15, 16, 0).getTime(), allDay: false, description: "Approved\n#today-remind" };
  const plain = { ...shift, id: "10:1", eventId: 10, title: "Dentist", description: "no tag" };
  const withEvents = (): AppData => base({ calendarEvents: convertCalendarEvents([shift, plain], 0) });

  it("is flagged when the notes carry the tag, and only then", () => {
    const [a, b] = withEvents().calendarEvents!;
    expect(a.remind).toBe(true);
    expect(b.remind).toBeUndefined();
  });

  it("gets the three reminders: 2 days before 19:00, the evening before 21:00, and 1 hour before", () => {
    const plan = planNotifications(withEvents(), NOW);
    const mine = plan.filter((n) => /WTM|shift/i.test(n.title + n.body) || n.key.includes("cal:9:1"));
    const at = (k: string) => mine.find((n) => n.key.startsWith(k + ":cal:9:1"))?.at;
    expect(at("prep2")).toEqual(new Date(2026, 9, 13, 19, 0));
    expect(at("prep1")).toEqual(new Date(2026, 9, 14, 21, 0));
    expect(at("event")).toEqual(new Date(2026, 9, 15, 9, 0));
  });

  it("an untagged phone event keeps its old behaviour: no reminders from Today", () => {
    const plan = planNotifications(withEvents(), NOW);
    expect(plan.some((n) => n.key.includes("cal:10:1"))).toBe(false);
  });

  it("shows a card when it clashes with work hours, and the day re-plans around it", () => {
    const d = withEvents();
    const clashes = remindClashes(d, "2026-10-12");
    expect(clashes).toHaveLength(1);
    expect(clashes[0].event.title).toContain("WTM");
    expect(clashes[0].clash.kind).toBe("work");
    // Answered (adjusted or kept): the card goes away.
    const answered = { ...d, settings: { ...d.settings, clashDismissed: [clashes[0].event.id] } };
    expect(remindClashes(answered, "2026-10-12")).toEqual([]);
    // An event outside work hours does not clash.
    const evening = base({ calendarEvents: convertCalendarEvents([{ ...shift, begin: new Date(2026, 9, 15, 18, 0).getTime(), end: new Date(2026, 9, 15, 21, 0).getTime() }], 0) });
    expect(remindClashes(evening, "2026-10-12")).toEqual([]);
  });
});
