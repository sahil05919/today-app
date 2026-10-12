import { describe, expect, it } from "vitest";
import { dayRules } from "../lib/busy";
import { planNotifications, shortShift } from "../lib/notifications/plan";
import { isExempt } from "../lib/notifications/budget";
import { setBlock } from "../lib/ripple";
import { plannedForDay } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { clashesFor } from "../lib/shareClash";
import { parseShared } from "../lib/shareParse";
import { buildTimeline } from "../lib/timeline";
import type { AppData, FixedEvent } from "../lib/types";

// Mon 12 Oct 2026. The shift is on Tue 3 Nov 2026.
const NOW = new Date(2026, 9, 12, 20, 0);
const TEXT = "Pinnacle Event Staff … Approved … Tue, 3 Nov 2026 (07:00-10:00 GMT) · PE898 World Traveller Market Exhibition, Standby";
const base = (over: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW), ...over });
const shiftEvent = (): FixedEvent => {
  const p = parseShared(TEXT, NOW)!;
  return { id: "wtm", title: p.title, date: p.date, start: p.start, end: p.end, area: p.area, status: p.status, shift: p.shift, createdAt: 1 };
};

describe("6. the clash check", () => {
  it("the Pinnacle shift clashes with work 09:00-17:00, and says what to do", () => {
    const c = clashesFor(base(), shiftEvent(), "2026-10-12");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "work", text: "Clashes with work 09:00–17:00. Book leave or adjust work start?" });
    // Starting work after the shift (half an hour to get home) clears it, and work still ends when it did.
    expect(c[0].fix).toEqual({ start: 10 * 60 + 30, min: 17 * 60 - (10 * 60 + 30) });
  });

  it("'Adjust work start that day' is a Just-today routine edit and clears the clash", () => {
    const d = base();
    const fix = clashesFor(d, shiftEvent(), "2026-10-12")[0].fix!;
    const after = setBlock(d, "work", "2026-11-03", fix, "today");
    expect(dayRules(after, "2026-11-03").work).toEqual([10 * 60 + 30, 17 * 60]);
    // Other days keep their usual hours.
    expect(dayRules(after, "2026-11-04").work).toEqual([9 * 60, 17 * 60]);
    expect(clashesFor({ ...after, events: [shiftEvent()] }, { ...shiftEvent(), id: "wtm" }, "2026-10-12")).toEqual([]);
  });

  it("an event on a day off, or on a weekend, does not clash with work; two booked things do clash", () => {
    expect(clashesFor(base(), { date: "2026-11-07", start: "07:00", end: "10:00" }, "2026-10-12")).toEqual([]); // Saturday
    const withDinner = base({ events: [{ id: "d", title: "Dinner", date: "2026-11-03", start: "18:00", end: "20:00", createdAt: 1 }] });
    const c = clashesFor(withDinner, { date: "2026-11-03", start: "19:00", end: "21:00" }, "2026-10-12");
    expect(c.some((x) => x.kind === "fixed" && /Dinner/.test(x.text))).toBe(true);
    expect(clashesFor(base(), { date: "2026-11-03" }, "2026-10-12")).toEqual([]); // no time: nothing to clash
  });
});

describe("6. the lead-up reminders", () => {
  // Reminders are planned a fortnight ahead and re-planned every day, so they appear once the shift is inside that window.
  const SOON = new Date(2026, 9, 28, 20, 0);
  const d = base({ events: [shiftEvent()] });
  const list = planNotifications(d, SOON, { budget: Infinity });

  it("2 days before at 19:00, the evening before at 21:00, and 1 hour before", () => {
    const two = list.find((n) => n.key === "prep2:wtm")!;
    expect([two.at.getDate(), two.at.getMonth(), two.at.getHours(), two.at.getMinutes()]).toEqual([1, 10, 19, 0]);
    expect(two.body).toBe("Tue 07:00: WTM shift. Plan your morning");
    const one = list.find((n) => n.key === "prep1:wtm")!;
    expect([one.at.getDate(), one.at.getHours(), one.at.getMinutes()]).toEqual([2, 21, 0]);
    expect(one.body).toBe("Tomorrow 07:00 shift: set an alarm");
    const hour = list.find((n) => n.key === "event:wtm")!;
    expect([hour.at.getDate(), hour.at.getHours(), hour.at.getMinutes()]).toEqual([3, 6, 0]);
  });

  it("they do not count towards the daily five (they have a time of their own)", () => {
    expect(isExempt({ kind: "eventprep" })).toBe(true);
    const capped = planNotifications(d, SOON);
    expect(capped.some((n) => n.key === "prep2:wtm")).toBe(true);
    expect(capped.some((n) => n.key === "prep1:wtm")).toBe(true);
  });

  it("an ordinary event gets no lead-up, and a shift in the past gets none", () => {
    const plain = base({ events: [{ ...shiftEvent(), shift: undefined }] });
    expect(planNotifications(plain, SOON, { budget: Infinity }).some((n) => n.kind === "eventprep")).toBe(false);
    expect(planNotifications(d, new Date(2026, 10, 3, 8, 0), { budget: Infinity }).some((n) => n.kind === "eventprep")).toBe(false);
    expect(shortShift("WTM Exhibition shift (Pinnacle) — Standby")).toBe("WTM shift");
    expect(shortShift("Dentist")).toBe("Dentist");
  });
});

describe("6. the day re-plans around the shift", () => {
  it("no session or flexible item sits in the shift's window any more", () => {
    const day = "2026-11-03";
    const d = base({ events: [shiftEvent()] });
    const tl = buildTimeline(d, day, new Date(`${day}T00:00:00`), { today: "2026-10-12" });
    const live = tl.items.filter((x) => !x.fixed && !x.muted && !x.done && x.kind !== "event");
    for (const it of live) expect(it.end <= 7 * 60 - 10 || it.start >= 10 * 60 + 10, `${it.title} ${it.start}-${it.end}`).toBe(true);
    expect(tl.items.some((x) => x.eventId === "wtm" && x.start === 7 * 60 && x.end === 10 * 60)).toBe(true);
    // The "before work" meditation (08:00) is no longer there that morning.
    expect(plannedForDay(d, day).some((s) => s.areaId === "meditation" && s.start >= 7 * 60 && s.start < 10 * 60)).toBe(false);
  });
});
