import { describe, expect, it } from "vitest";
import { parseCapture } from "../lib/parse";
import { extractRecurrence, firstOccurrence, nextOccurrence, recurLabel } from "../lib/recur";

const NOW = new Date(2026, 9, 6, 10, 0); // Tue 6 Oct 2026

describe("extractRecurrence", () => {
  it.each([
    ["every Monday", { freq: "weekly", interval: 1, weekdays: [1] }],
    ["every Mon and Thu", { freq: "weekly", interval: 1, weekdays: [1, 4] }],
    ["weekdays", { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] }],
    ["daily", { freq: "daily", interval: 1 }],
    ["every day", { freq: "daily", interval: 1 }],
    ["every 2 weeks", { freq: "weekly", interval: 2 }],
    ["every other Friday", { freq: "weekly", interval: 2, weekdays: [5] }],
    ["every 1st", { freq: "monthly", interval: 1, monthDay: 1 }],
    ["every month on the 15th", { freq: "monthly", interval: 1, monthDay: 15 }],
    ["monthly", { freq: "monthly", interval: 1 }],
  ])("%s", (phrase, expected) => {
    expect(extractRecurrence(phrase).recur).toEqual(expected);
  });

  it("returns no rule for ordinary text", () => {
    expect(extractRecurrence("buy milk on monday").recur).toBeUndefined();
  });
});

describe("occurrences", () => {
  it("weekly on Monday: next Monday", () => {
    expect(nextOccurrence({ freq: "weekly", interval: 1, weekdays: [1] }, "2026-10-12")).toBe("2026-10-19");
  });
  it("weekdays skip the weekend", () => {
    const r = { freq: "weekly" as const, interval: 1, weekdays: [1, 2, 3, 4, 5] };
    expect(nextOccurrence(r, "2026-10-09")).toBe("2026-10-12");
    expect(firstOccurrence(r, "2026-10-10")).toBe("2026-10-12");
  });
  it("every 2 weeks on Monday and Thursday", () => {
    const r = { freq: "weekly" as const, interval: 2, weekdays: [1, 4] };
    expect(nextOccurrence(r, "2026-10-12")).toBe("2026-10-15");
    expect(nextOccurrence(r, "2026-10-15")).toBe("2026-10-26");
  });
  it("monthly on the 31st clamps to short months", () => {
    const r = { freq: "monthly" as const, interval: 1, monthDay: 31 };
    expect(nextOccurrence(r, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence(r, "2026-02-28")).toBe("2026-03-31");
  });
  it("monthly on the 1st", () => {
    expect(nextOccurrence({ freq: "monthly", interval: 1, monthDay: 1 }, "2026-10-01")).toBe("2026-11-01");
    expect(nextOccurrence({ freq: "monthly", interval: 1, monthDay: 25 }, "2026-10-20")).toBe("2026-10-25");
  });
  it("daily with an interval", () => {
    expect(nextOccurrence({ freq: "daily", interval: 3 }, "2026-10-06")).toBe("2026-10-09");
  });
  it("labels", () => {
    expect(recurLabel({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(recurLabel({ freq: "weekly", interval: 1, weekdays: [1, 4] })).toBe("Every Mon, Thu");
    expect(recurLabel({ freq: "monthly", interval: 1, monthDay: 1 })).toBe("Monthly, 1st");
  });
});

describe("capture with repeats", () => {
  it.each([
    ["every Monday standup", "Standup", "2026-10-12", { freq: "weekly", weekdays: [1] }],
    ["har somvar gym", "Gym", "2026-10-12", { freq: "weekly", weekdays: [1] }],
    ["हर सोमवार जिम", "जिम", "2026-10-12", { freq: "weekly", weekdays: [1] }],
    ["daily vitamins", "Vitamins", "2026-10-06", { freq: "daily" }],
    ["roz subah vitamin", "Vitamin", "2026-10-06", { freq: "daily" }],
    ["har din walk", "Walk", "2026-10-06", { freq: "daily" }],
    ["weekdays check inbox", "Check inbox", "2026-10-06", { freq: "weekly" }],
    ["every 1st pay rent", "Pay rent", "2026-11-01", { freq: "monthly", monthDay: 1 }],
    ["har mahine ki 5 tarikh rent", "Rent", "2026-11-05", { freq: "monthly", monthDay: 5 }],
    ["har mahine ki 10 tarikh rent", "Rent", "2026-10-10", { freq: "monthly", monthDay: 10 }],
  ])("%s", (phrase, title, due, recur) => {
    const p = parseCapture(phrase, NOW);
    expect(p.title).toBe(title);
    expect(p.due).toBe(due);
    expect(p.recur).toMatchObject(recur);
  });

  it("keeps a time of day", () => {
    const p = parseCapture("weekdays 9am standup", NOW);
    expect(p).toMatchObject({ title: "Standup", due: "2026-10-06", dueTime: "09:00" });
  });
});
