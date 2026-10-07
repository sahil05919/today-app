import { describe, expect, it } from "vitest";
import { convertCalendarEvents, parseICS } from "../lib/calendar";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { buildTimeline } from "../lib/timeline";
import { planNotifications } from "../lib/notifications/plan";
import { toHHMM } from "../lib/profile";
import type { AppData } from "../lib/types";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const MON = new Date(2026, 9, 5, 7, 0);
const base = (): AppData => seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, MON);

describe("phone calendar → fixed blocks", () => {
  it("a timed event becomes a block on its day", () => {
    const [e] = convertCalendarEvents([{ id: "1", title: "Dentist", begin: at(2026, 10, 8, 15), end: at(2026, 10, 8, 16), allDay: false }]);
    expect(e).toMatchObject({ title: "Dentist", date: "2026-10-08", start: "15:00", end: "16:00", source: "calendar" });
  });

  it("all-day events (UTC midnights) land on the right date and stay all day", () => {
    const [e] = convertCalendarEvents([{ id: "2", title: "Holiday", begin: Date.UTC(2026, 9, 9), end: Date.UTC(2026, 9, 10), allDay: true }]);
    expect(e.date).toBe("2026-10-09");
    expect(e.start).toBeUndefined();
  });

  it("a multi-day all-day event gives one entry per day, end exclusive", () => {
    const list = convertCalendarEvents([{ id: "3", title: "Trip", begin: Date.UTC(2026, 9, 9), end: Date.UTC(2026, 9, 12), allDay: true }]);
    expect(list.map((x) => x.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
  });

  it("an event over midnight is clipped to each day", () => {
    const list = convertCalendarEvents([{ id: "4", title: "Night shift", begin: at(2026, 10, 8, 22), end: at(2026, 10, 9, 2), allDay: false }]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ date: "2026-10-08", start: "22:00", end: "23:59" });
    expect(list[1]).toMatchObject({ date: "2026-10-09", start: "00:00", end: "02:00" });
  });

  it("ids are stable, so a re-sync replaces rather than duplicates", () => {
    const raw = [{ id: "9:1", title: "Gym", begin: at(2026, 10, 8, 7), end: at(2026, 10, 8, 8), allDay: false }];
    expect(convertCalendarEvents(raw, 0)).toEqual(convertCalendarEvents(raw, 0));
  });

  it("sessions reshuffle around them, and they show as fixed blocks on the timeline", () => {
    const d: AppData = { ...base(), calendarEvents: convertCalendarEvents([{ id: "5", title: "Client dinner", begin: at(2026, 10, 7, 18), end: at(2026, 10, 7, 21), allDay: false }], 0) };
    for (const s of planSessions(d, MON).filter((x) => x.date === "2026-10-07")) {
      const clash = s.start < 21 * 60 + 10 && s.end > 17 * 60 + 50;
      expect(clash, `${s.title} ${toHHMM(s.start)} overlaps the dinner`).toBe(false);
    }
    const tl = buildTimeline(d, "2026-10-07", MON);
    expect(tl.items.find((x) => x.title === "Client dinner")).toMatchObject({ kind: "calendar", fixed: true });
  });

  it("doesn't add its own reminders (your calendar app already does)", () => {
    const d: AppData = { ...base(), calendarEvents: convertCalendarEvents([{ id: "6", title: "Client dinner", begin: at(2026, 10, 8, 18), end: at(2026, 10, 8, 21), allDay: false }], 0) };
    expect(planNotifications(d, MON).some((n) => n.kind === "event")).toBe(false);
  });
});

describe(".ics invites", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Team lunch\\, with Priya",
    "DTSTART:20261009T120000",
    "DTEND:20261009T133000",
    "LOCATION:Cafe Nero",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Bank holiday",
    "DTSTART;VALUE=DATE:20261012",
    "DTEND;VALUE=DATE:20261013",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("reads timed and all-day events", () => {
    expect(parseICS(ics)).toEqual([
      { title: "Team lunch, with Priya", date: "2026-10-09", start: "12:00", end: "13:30", location: "Cafe Nero" },
      { title: "Bank holiday", date: "2026-10-12", start: undefined, end: undefined, location: undefined },
    ]);
  });

  it("joins folded lines", () => {
    const folded = "BEGIN:VEVENT\r\nSUMMARY:A very long\r\n  title here\r\nDTSTART:20261009T090000\r\nEND:VEVENT";
    expect(parseICS(folded)[0].title).toBe("A very long title here");
  });

  it("converts UTC times (Z) to local time", () => {
    const [e] = parseICS("BEGIN:VEVENT\nSUMMARY:Call\nDTSTART:20261009T120000Z\nEND:VEVENT");
    const local = new Date(Date.UTC(2026, 9, 9, 12, 0));
    expect(e.start).toBe(`${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`);
  });

  it("gives back nothing for a file that isn't a calendar", () => {
    expect(parseICS("hello")).toEqual([]);
  });
});
