import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayRules } from "../lib/busy";
import { addDays } from "../lib/dates";
import { eventMarkKey } from "../lib/fixed";
import { blockSpan, rippleNote, setBlock, skipBlock } from "../lib/ripple";
import { plannedForDay, planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { actions, flushNow, getData, KEY, localStorageAdapter } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import { toHHMM } from "../lib/profile";
import { migrate } from "../lib/backup";
import type { AppData, FixedEvent } from "../lib/types";

// Mon 19 Oct 2026: an office day (45 min commute each way). The week is Mon 19 … Sun 25.
const MON = "2026-10-19";
const NOW = new Date(2026, 9, 19, 6, 0);
const base = (over: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded({ version: 2, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW), ...over });
const phone = (over: Partial<FixedEvent> = {}): FixedEvent => ({ id: "cal:77:2026-10-19", calId: "77", title: "Team catch-up", date: MON, start: "17:00", end: "17:30", createdAt: 1, source: "calendar", ...over });
const at = (d: AppData, day: string, title: RegExp) => buildTimeline(d, day, new Date(day + "T00:00:00")).items.find((x) => title.test(x.title));
const sessionsOn = (d: AppData, day: string) => plannedForDay(d, day).filter((s) => !s.done);

describe("C. routine blocks: Commute 45 → 120", () => {
  const d0 = base({ calendarEvents: [phone()] });
  const d1 = setBlock(d0, "commute-from", MON, { min: 120 }, "today");

  it("the commute is longer and the tea break (and the evening) start later", () => {
    expect(blockSpan(d0, "commute-from", MON)).toEqual([17 * 60, 17 * 60 + 45]);
    expect(blockSpan(d1, "commute-from", MON)).toEqual([17 * 60, 19 * 60]);
    expect(dayRules(d1, MON).shift).toBe(75);
    expect(dayRules(d0, MON).shift).toBe(0);
  });

  it("later flexible things shift forward; the 17:00 calendar event stays fixed", () => {
    const b = Object.fromEntries(sessionsOn(d0, MON).map((s) => [s.areaId, s.start]));
    const a = Object.fromEntries(sessionsOn(d1, MON).map((s) => [s.areaId, s.start]));
    // Walking and Job Apply are still on Monday, later than before
    expect(a.walking).toBeGreaterThan(b.walking);
    expect(a.job).toBeGreaterThan(b.job);
    // everything starts after the commute and the tea break
    for (const s of sessionsOn(d1, MON)) if (s.start >= 17 * 60) expect(s.start).toBeGreaterThanOrEqual(20 * 60);
    // the event did not move
    expect(at(d0, MON, /Team catch-up/)).toMatchObject({ start: 17 * 60, fixed: true });
    expect(at(d1, MON, /Team catch-up/)).toMatchObject({ start: 17 * 60, fixed: true });
  });

  it("what no longer fits before ~22:30 is not dropped: a daily habit finds other time (the target is a hard rule)", () => {
    // English is a daily habit, so there is no other day to take it: it moves to the free morning before the commute.
    const eve = sessionsOn(d1, MON).filter((s) => s.start >= 17 * 60);
    expect(eve.map((s) => s.areaId)).not.toContain("english");
    expect(eve.every((s) => s.end <= 22 * 60 + 30)).toBe(true);
    const english = sessionsOn(d1, MON).find((s) => s.areaId === "english")!;
    expect(english).toBeTruthy();
    expect(english.end).toBeLessThanOrEqual(8 * 60);
    // The week still has all seven.
    expect(planSessions(d1, NOW).filter((s) => s.areaId === "english" && !s.done)).toHaveLength(7);
    expect(rippleNote(d0, d1, MON, "Commute", 75, NOW)).toMatch(/^Commute \+75 min → /);
  });

  it("'Just today' does not leak into the next office day", () => {
    const nextMon = addDays(MON, 7);
    expect(blockSpan(d1, "commute-from", nextMon)).toEqual([17 * 60, 17 * 60 + 45]);
    expect(dayRules(d1, nextMon).shift).toBe(0);
    expect(d1.profile?.officeCommuteMin ?? 45).toBe(45);
  });

  it("'Every day' updates the rhythm setting, so every office day changes", () => {
    const every = setBlock(d0, "commute-from", MON, { min: 120 }, "every");
    expect(every.profile?.officeCommuteMin).toBe(120);
    expect(blockSpan(every, "commute-from", addDays(MON, 7))).toEqual([17 * 60, 19 * 60]);
    expect(every.blocks?.[`commute-from@${MON}`]).toBeUndefined();
  });

  it("Skip today frees the time again", () => {
    const skipped = skipBlock(d0, "commute-from", MON);
    expect(blockSpan(skipped, "commute-from", MON)).toBeNull();
    expect(at(skipped, MON, /Commute home/)).toBeUndefined();
    expect(blockSpan(skipped, "commute-from", addDays(MON, 7))).not.toBeNull();
  });

  it("a block can start at another time too (Lunch at 13:30, 30 min)", () => {
    const l = setBlock(d0, "lunch", MON, { start: 13 * 60 + 30, min: 30 }, "today");
    expect(blockSpan(l, "lunch", MON)).toEqual([13 * 60 + 30, 14 * 60]);
    expect(toHHMM(blockSpan(l, "lunch", MON)![0])).toBe("13:30");
  });
});

describe("C. phone calendar events: tick, hide, local time", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    actions.replaceAll(base({ calendarEvents: [phone()] }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a ticked event persists after a restart, and a calendar re-sync keeps the tick", async () => {
    const key = eventMarkKey(phone());
    expect(key).toBe(`77@${MON}`);
    actions.markEvent(key, { done: 1_000 });
    expect(at(getData(), MON, /Team catch-up/)!.done).toBe(true);
    // "restart": saving is debounced, so flush (as the app does when it goes to the background), then read what was saved
    await flushNow();
    const reloaded = migrate(JSON.parse(store.get(KEY)!));
    expect(reloaded.eventMarks?.[key]?.done).toBe(1_000);
    expect(at(reloaded, MON, /Team catch-up/)!.done).toBe(true);
    // the phone's calendar is read again: events are replaced, the tick stays
    actions.setCalendarEvents([phone({ id: "cal:77:2026-10-19#2" })]);
    expect(at(getData(), MON, /Team catch-up/)!.done).toBe(true);
    expect(localStorageAdapter.load()!.eventMarks?.[key]?.done).toBe(1_000);
  });

  it("hide for today removes it from the day (and its blocked time); only that day", () => {
    const next = phone({ id: "cal:77:2026-10-26", date: addDays(MON, 7) });
    actions.setCalendarEvents([phone(), next]);
    actions.markEvent(eventMarkKey(phone()), { hidden: true });
    expect(at(getData(), MON, /Team catch-up/)).toBeUndefined();
    expect(at(getData(), addDays(MON, 7), /Team catch-up/)).toBeTruthy();
  });

  it("a local time override moves it here only; the calendar copy is untouched", () => {
    actions.markEvent(eventMarkKey(phone()), { start: "17:30" });
    const it = at(getData(), MON, /Team catch-up/)!;
    // same length (30 min), new start
    expect([it.start, it.end]).toEqual([17 * 60 + 30, 18 * 60]);
    expect(getData().calendarEvents![0].start).toBe("17:00");
  });
});
