import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupName, backupText, inspectBackup, newestBackup, nextSunday2130, preRestoreName, previousSunday2130, toDelete, weeklyOverdue } from "../lib/backupFiles";
import { pickDefaultCalendar, removeEventFromCalendar, syncEventToCalendar, toNativeEvent, withoutOwnEvents, type CalendarBridge } from "../lib/calendarWrite";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import type { WritableCalendar } from "../lib/nativeBridge";
import type { AppData, FixedEvent } from "../lib/types";

const hm = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("7. the weekly backup schedule: Sunday 21:30", () => {
  it("the next one, from any moment", () => {
    expect(hm(nextSunday2130(new Date(2026, 9, 12, 8, 0)))).toBe("2026-10-18 21:30"); // Monday
    expect(hm(nextSunday2130(new Date(2026, 9, 18, 21, 0)))).toBe("2026-10-18 21:30"); // Sunday, before it
    expect(hm(nextSunday2130(new Date(2026, 9, 18, 21, 30)))).toBe("2026-10-25 21:30"); // exactly on it: the next week's
    expect(hm(nextSunday2130(new Date(2026, 9, 18, 23, 0)))).toBe("2026-10-25 21:30");
  });
  it("the last one that has passed, and across the clock change on 25 Oct 2026", () => {
    expect(hm(previousSunday2130(new Date(2026, 9, 12, 8, 0)))).toBe("2026-10-11 21:30");
    expect(hm(previousSunday2130(new Date(2026, 9, 18, 21, 30)))).toBe("2026-10-18 21:30");
    expect(hm(previousSunday2130(new Date(2026, 9, 26, 9, 0)))).toBe("2026-10-25 21:30");
    expect(hm(nextSunday2130(new Date(2026, 9, 20, 9, 0)))).toBe("2026-10-25 21:30");
  });
  it("overdue when a Sunday 21:30 passed since the last backup (the alarm did not fire)", () => {
    const mon = new Date(2026, 9, 12, 8, 0);
    expect(weeklyOverdue(new Date(2026, 9, 11, 21, 31).getTime(), mon)).toBe(false);
    expect(weeklyOverdue(new Date(2026, 9, 11, 21, 29).getTime(), mon)).toBe(true);
    expect(weeklyOverdue(undefined, mon)).toBe(true);
    expect(weeklyOverdue(0, mon)).toBe(true);
  });
  it("the newest of the file backup and the recorded one (for 'No backup for N days')", () => {
    expect(newestBackup(5, 9)).toBe(9);
    expect(newestBackup(undefined, undefined)).toBeUndefined();
  });
});

describe("7. backup files", () => {
  it("are named today-YYYY-MM-DD.json, and pre-restore copies say so", () => {
    expect(backupName(new Date(2026, 9, 18, 21, 30))).toBe("today-2026-10-18.json");
    expect(preRestoreName(new Date(2026, 9, 18, 9, 5))).toBe("today-pre-restore-2026-10-18-0905.json");
  });
  it("keep the last 8, and nothing but the weekly files is ever pruned", () => {
    // Eleven Sundays, oldest first, plus a pre-restore copy and a stray file that must never be touched.
    const sundays = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11"].map((d) => `today-${d}.json`);
    const names = [...sundays, "today-pre-restore-2026-10-18-0905.json", "notes.txt"];
    expect(toDelete(names, 8)).toEqual(["today-2026-08-16.json", "today-2026-08-09.json", "today-2026-08-02.json"]);
    expect(toDelete(sundays.slice(0, 8), 8)).toEqual([]);
    // The order the names arrive in does not matter.
    expect(toDelete([...names].reverse(), 8).sort()).toEqual(["today-2026-08-02.json", "today-2026-08-09.json", "today-2026-08-16.json"]);
  });
  it("are the whole data, without the phone-calendar mirror, and read back as a Today backup", () => {
    const d: AppData = { ...seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: 1 } }, new Date(2026, 9, 12)), calendarEvents: [{ id: "cal:1:2026-10-12", title: "Team sync", date: "2026-10-12", createdAt: 0, source: "calendar" }] };
    const text = backupText(d);
    expect(JSON.parse(text).calendarEvents).toBeUndefined();
    const back = inspectBackup(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.data.series?.length).toBe(d.series?.length);
    expect(inspectBackup("not json")).toEqual({ ok: false, error: "That file isn't valid JSON." });
    expect(inspectBackup(JSON.stringify({ hello: 1 }))).toMatchObject({ ok: false });
  });
});

describe("7. writing events to the phone calendar", () => {
  const cals: WritableCalendar[] = [
    { id: 3, name: "Work", account: "me@corp.com", accountType: "com.microsoft", primary: true },
    { id: 7, name: "Holidays", account: "me@gmail.com", accountType: "com.google", primary: false },
    { id: 9, name: "me@gmail.com", account: "me@gmail.com", accountType: "com.google", primary: true },
  ];
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    actions.replaceAll(seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: 1 } }, new Date(2026, 9, 12)));
  });
  afterEach(() => vi.unstubAllGlobals());

  const bridge = (over: Partial<CalendarBridge> = {}) => {
    const calls: Array<{ op: string; arg?: unknown }> = [];
    const b: CalendarBridge = {
      access: async () => "granted",
      ask: async () => "granted",
      calendars: async () => cals,
      upsert: async (e) => (calls.push({ op: "upsert", arg: e }), e.eventId ?? 4242),
      remove: async (id) => (calls.push({ op: "remove", arg: id }), true),
      ...over,
    };
    return { b, calls };
  };
  const add = (over: Partial<FixedEvent> = {}) => actions.addFixedEvent({ title: "WTM Exhibition shift (Pinnacle) — Standby", date: "2026-11-03", start: "07:00", end: "10:00", status: "Approved", area: "sidework", shift: true, ...over });

  it("goes to your Google account's own calendar by default", () => {
    expect(pickDefaultCalendar(cals)!.id).toBe(9);
    expect(pickDefaultCalendar([cals[0]])!.id).toBe(3);
    expect(pickDefaultCalendar([])).toBeUndefined();
  });

  it("a timed event, an all-day one, and one with no end", () => {
    const t = toNativeEvent({ id: "a", title: "Shift", date: "2026-11-03", start: "07:00", end: "10:00", status: "Approved", area: "sidework", createdAt: 1 }, 9);
    expect(t).toMatchObject({ calendarId: 9, title: "Shift", allDay: false });
    expect(new Date(t.start).getHours()).toBe(7);
    expect(t.end - t.start).toBe(3 * 3_600_000);
    expect(t.description).toBe("Added by Today · Approved · Side work");
    const noEnd = toNativeEvent({ id: "b", title: "Call", date: "2026-11-03", start: "19:30", createdAt: 1 }, 9);
    expect(noEnd.end - noEnd.start).toBe(3_600_000);
    const all = toNativeEvent({ id: "c", title: "Trip", date: "2026-11-03", createdAt: 1 }, 9);
    expect(all).toMatchObject({ allDay: true, start: Date.UTC(2026, 10, 3), end: Date.UTC(2026, 10, 4) });
  });

  it("adds it once, keeps the phone's id, and an edit updates the SAME entry (never a second one)", async () => {
    const { b, calls } = bridge();
    const e = add();
    expect(await syncEventToCalendar(e.id, b, true)).toBe("ok");
    expect(calls[0]).toMatchObject({ op: "upsert", arg: { calendarId: 9, title: "WTM Exhibition shift (Pinnacle) — Standby" } });
    expect((calls[0].arg as { eventId?: number }).eventId).toBeUndefined();
    expect(getData().events![0].calEventId).toBe("4242");
    // An edit: it is sent with the id it was given.
    actions.updateEvent(e.id, { start: "08:00", end: "11:00" });
    expect(await syncEventToCalendar(e.id, b, true)).toBe("ok");
    expect(calls[1].arg).toMatchObject({ eventId: 4242 });
    expect(getData().events![0].calEventId).toBe("4242");
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(2);
  });

  it("a delete takes it out of the calendar", async () => {
    const { b, calls } = bridge();
    const e = add();
    await syncEventToCalendar(e.id, b, true);
    const stored = getData().events![0];
    expect(await removeEventFromCalendar(stored, b, true)).toBe("ok");
    expect(calls[1]).toEqual({ op: "remove", arg: 4242 });
    expect(await removeEventFromCalendar({ ...stored, calEventId: undefined }, b, true)).toBe("off");
  });

  it("uses the calendar you chose, and does nothing when switched off, without permission, or for events that are not Today's own", async () => {
    const { b, calls } = bridge();
    const e = add();
    actions.setProfile({ ...getData().profile!, writeCalendarId: "7" });
    await syncEventToCalendar(e.id, b, true);
    expect(calls[0].arg).toMatchObject({ calendarId: 7 });

    actions.setProfile({ ...getData().profile!, calendarWrite: false });
    expect(await syncEventToCalendar(e.id, bridge().b, true)).toBe("off");

    actions.setProfile({ ...getData().profile!, calendarWrite: true });
    const denied = bridge({ access: async () => "denied" });
    expect(await syncEventToCalendar(e.id, denied.b, true)).toBe("no-permission");
    expect(denied.calls).toEqual([]);

    // An event opened from an invite file is already somebody's: not written.
    actions.addImportedEvents([{ title: "Invite", date: "2026-11-05", start: "10:00", end: "11:00" }]);
    const imported = getData().events!.find((x) => x.title === "Invite")!;
    expect(await syncEventToCalendar(imported.id, bridge().b, true)).toBe("off");
    // And on the web nothing happens at all.
    expect(await syncEventToCalendar(e.id, bridge().b, false)).toBe("unsupported");
  });

  it("when asked for the first time it asks once; a 'no' is not asked again", async () => {
    let asks = 0;
    const b = bridge({ access: async () => "prompt", ask: async () => (asks++, "denied") }).b;
    const e = add();
    expect(await syncEventToCalendar(e.id, b, true)).toBe("no-permission");
    expect(await syncEventToCalendar(e.id, b, true)).toBe("no-permission");
    expect(asks).toBe(1);
  });

  it("reading the calendar back never shows Today's own events twice", () => {
    const own = [{ id: "x", title: "Shift", date: "2026-11-03", createdAt: 1, calEventId: "4242" } as FixedEvent];
    const raw = [{ id: "4242:1", eventId: 4242 }, { id: "55:1", eventId: 55 }, { id: "no-id" }];
    expect(withoutOwnEvents(raw, own).map((r) => r.id)).toEqual(["55:1", "no-id"]);
    expect(withoutOwnEvents(raw, [])).toHaveLength(3);
  });
});
