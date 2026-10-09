import { describe, expect, it } from "vitest";
import { cleanLetter, buildWeekSummary, ruleLetter, trimWords, writeLetter, needsLetter } from "../lib/coach";
import { capacityOf, learnedSlots, MIN_DAYS, pendingSlotShifts } from "../lib/capacity";
import { addDays } from "../lib/dates";
import { letterFor, withLetter } from "../lib/letters";
import { overload, tickHint } from "../lib/load";
import { seedIfNeeded } from "../lib/seed";
import { planSessions } from "../lib/schedule";
import { weekStart } from "../lib/stats";
import type { AppData, CheckInAnswer, CoachLetter, SessionLog, Task } from "../lib/types";
import type { Fetcher } from "../lib/ai";

// Sun 18 Oct 2026, 10:00 (the end of a week). History runs back 8 weeks from here.
const NOW = new Date(2026, 9, 18, 10, 0);
const TODAY = "2026-10-18";
let n = 0;
const base = (): AppData => seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 7, 1).getTime() } }, NOW);
const at = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};
const done = (title: string, date: string): Task => ({ id: `c${++n}`, title, important: false, tags: [], steps: [], focus: false, status: "done", createdAt: 1, completedAt: at(date, 15) });
const log = (areaId: string, date: string, h: number, m: number, minutes = 60): SessionLog => ({ id: `l${++n}`, areaId, date, minutes, n: n, at: at(date, h, m), source: "manual" });

/** `count` finished tasks on each given date. */
function history(dates: string[], count: number): Task[] {
  return dates.flatMap((d) => Array.from({ length: count }, (_, i) => done(`T${i}`, d)));
}
/** The dates in the 8 weeks before TODAY that fall on a weekday (0 = Sunday). */
const weekdays = (dow: number) => Array.from({ length: 56 }, (_, i) => addDays(TODAY, -(i + 1))).filter((d) => new Date(d + "T00:00:00").getDay() === dow);

describe("learning capacity", () => {
  it("says it is still learning until there are 10 days of history", () => {
    const d = { ...base(), tasks: history(weekdays(5).slice(0, 6), 2) }; // six Fridays
    const cap = capacityOf(d, TODAY);
    expect(cap.days).toBe(6);
    expect(cap.enough).toBe(false);
    const h = tickHint(d, NOW, "ok");
    expect(h.hint).toBeNull();
    expect(h.progress).toBe("Learning your rhythm · 6 of 10 days");
    expect(overload(d, NOW, TODAY)).toBeNull();
  });

  it("learns the typical number per weekday and the share of planned things finished", () => {
    const fridays = weekdays(5);
    const mondays = weekdays(1);
    const d: AppData = {
      ...base(),
      tasks: [...history(fridays, 3), ...history(mondays, 1)],
      // On three Mondays he also skipped one planned thing.
      log: mondays.slice(0, 3).map((m) => ({ key: `chore:emails:${m}`, status: "skip" as const, at: at(m, 20) })),
    };
    const cap = capacityOf(d, TODAY);
    expect(cap.enough).toBe(true);
    expect(cap.days).toBeGreaterThanOrEqual(MIN_DAYS);
    expect(cap.weekday[5]).toMatchObject({ typical: 3, days: 8 });
    expect(cap.weekday[1].typical).toBe(1);
    expect(cap.weekday[5].pct).toBe(1);
    expect(cap.weekday[1].pct).toBeCloseTo(8 / 11, 2);
  });

  it("the morning check-in pre-ticks the realistic count and explains it", () => {
    const d: AppData = { ...base(), tasks: [...history(weekdays(5), 3), ...history(weekdays(1), 1)] };
    const fri = new Date(2026, 9, 16, 8, 0);
    const h = tickHint(d, fri, "ok");
    expect(h.hint).toEqual({ count: 3, note: "You usually finish about 3 on Fridays." });
  });

  it("learns what he finishes on low, okay and great days from his check-in answers", () => {
    const fridays = weekdays(5);
    const answers: CheckInAnswer[] = fridays.map((date, i) => ({ date, energy: i < 4 ? "low" : "high", ticked: 2, offered: 5, at: 1 }));
    // Low days: 1 thing. Great days: 5.
    const tasks = fridays.flatMap((date, i) => Array.from({ length: i < 4 ? 1 : 5 }, () => done("x", date)));
    const d: AppData = { ...base(), tasks: [...tasks, ...history(weekdays(1), 2)], checkins: answers };
    const cap = capacityOf(d, TODAY);
    expect(cap.byEnergy.low).toMatchObject({ days: 4, typical: 1 });
    expect(cap.byEnergy.high).toMatchObject({ days: 4, typical: 5 });
    const fri = new Date(2026, 9, 16, 8, 0);
    expect(tickHint(d, fri, "low").hint!.count).toBeLessThan(tickHint(d, fri, "high").hint!.count);
  });

  it("says plainly when a day is clearly more than he usually finishes", () => {
    const sat = weekdays(6);
    const d: AppData = { ...base(), tasks: [...history(sat, 1), ...history(weekdays(1), 2)] };
    // Saturday 17 Oct: lots due, he usually finishes about 1.
    const day = new Date(2026, 9, 17, 7, 0);
    const heavy: AppData = { ...d, tasks: [...d.tasks, ...Array.from({ length: 8 }, (_, i): Task => ({ id: `h${i}`, title: `Heavy ${i}`, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, due: "2026-10-17", estimateMin: 20 }))] };
    const o = overload(heavy, day, "2026-10-17");
    expect(o).not.toBeNull();
    expect(o!.message).toMatch(/usually finish about 1 on Saturdays/);
    // A day that matches what he usually finishes is left alone.
    const busyHistory: AppData = { ...base(), tasks: [...history(sat, 4), ...history(weekdays(1), 2)] };
    expect(overload(busyHistory, day, "2026-10-17")).toBeNull();
  });
});

describe("the planner offers the slot where an area really happens", () => {
  // Power BI is allowed in Evening and Before work, Evening first. For 6 weeks it really happened at ~08:15.
  const sessions = (): SessionLog[] =>
    weekdays(2)
      .concat(weekdays(3))
      .slice(0, 8)
      .map((d) => log("powerbi", d, 9, 15, 60));
  const withHistory = (patch?: (d: AppData) => AppData): AppData => {
    const d = { ...base(), sessions: sessions() };
    return patch ? patch(d) : d;
  };
  const monday = new Date(2026, 9, 19, 6, 0);
  const firstSlot = (d: AppData) => planSessions(d, monday).find((s) => s.areaId === "powerbi" && !s.done)!.slotId;

  it("offers the learned slot first", () => {
    expect(learnedSlots(withHistory(), "2026-10-19").get("powerbi")).toBe("before");
    expect(firstSlot(withHistory())).toBe("before");
    // Without the history the configured first choice (Evening) is used.
    expect(firstSlot(base())).toBe("evening");
  });

  it("never overrides an exact time or a slot order he locked", () => {
    const withAt = withHistory((d) => ({ ...d, profile: { ...d.profile!, areas: d.profile!.areas.map((a) => (a.id === "powerbi" ? { ...a, target: { ...a.target!, at: "19:00" } } : a)) } }));
    expect(learnedSlots(withAt, "2026-10-19").has("powerbi")).toBe(false);
    const locked = withHistory((d) => ({ ...d, profile: { ...d.profile!, areas: d.profile!.areas.map((a) => (a.id === "powerbi" ? { ...a, target: { ...a.target!, lockSlots: true } } : a)) } }));
    expect(learnedSlots(locked, "2026-10-19").has("powerbi")).toBe(false);
    expect(firstSlot(locked)).toBe("evening");
  });

  it("never invents a slot he didn't allow", () => {
    const d = withHistory((x) => ({ ...x, profile: { ...x.profile!, areas: x.profile!.areas.map((a) => (a.id === "powerbi" ? { ...a, target: { ...a.target!, slots: ["evening", "night"] } } : a)) } }));
    expect(learnedSlots(d, "2026-10-19").get("powerbi")).not.toBe("before");
  });

  it("needs enough sessions before it learns anything", () => {
    const few = { ...base(), sessions: sessions().slice(0, 2) };
    expect(learnedSlots(few, "2026-10-19").size).toBe(0);
  });

  it("mentions a shift once, never silently", () => {
    const d = withHistory();
    const notes = pendingSlotShifts(d, "2026-10-19");
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(/Power BI usually happens in your "Before work" slot/);
    const seen: AppData = { ...d, settings: { ...d.settings, slotShifts: { powerbi: "before" } } };
    expect(pendingSlotShifts(seen, "2026-10-19")).toHaveLength(0);
  });
});

describe("the Sunday coach letter", () => {
  const weekData = (): AppData => {
    const d = base();
    const start = weekStart(TODAY);
    return {
      ...d,
      sessions: [log("meditation", addDays(start, 0), 8, 30, 15), log("meditation", addDays(start, 1), 8, 30, 15), log("meditation", addDays(start, 2), 8, 30, 15), log("powerbi", addDays(start, 1), 19, 0, 60)],
      tasks: [done("Pay card", addDays(start, 2))],
      log: [{ key: `session:powerbi:${addDays(start, 3)}`, status: "skip", at: at(addDays(start, 3), 20) }],
      checkins: [{ date: addDays(start, 0), energy: "low", ticked: 2, offered: 5, at: 1 }, { date: addDays(start, 1), energy: "low", ticked: 2, offered: 5, at: 1 }],
    };
  };

  it("builds a compact summary: counts and titles, never notes", () => {
    const withNotes = weekData();
    withNotes.tasks = [{ ...withNotes.tasks[0], notes: "SECRET NOTE TEXT" }];
    const s = buildWeekSummary(withNotes, TODAY);
    expect(JSON.stringify(s)).not.toContain("SECRET");
    expect(s.week).toBe("2026-10-12");
    expect(s.areas.find((a) => a.name === "Meditation")).toMatchObject({ done: 3, target: 3 });
    expect(s.areas.find((a) => a.name === "Power BI")).toMatchObject({ done: 1, target: 4 });
    expect(s.skipped).toContain("Power BI");
    expect(s.moods).toEqual({ low: 2, ok: 0, high: 0 });
    expect(s.tasksDone).toBe(1);
    expect(JSON.stringify(s).length).toBeLessThan(2500);
  });

  it("the fallback letter says what went well, what slipped and why, and one small change", () => {
    const s = buildWeekSummary(weekData(), TODAY);
    const text = ruleLetter(s);
    expect(text.startsWith("Dear Sahil,")).toBe(true);
    expect(text).toMatch(/Meditation reached its target/);
    // The biggest gap is named first, with the most likely reason from the week itself.
    expect(text).toMatch(/English Reading fell short \(0 of 7\)/);
    expect(text).toMatch(/low-energy mornings/);
    const power = ruleLetter({ ...s, areas: [{ name: "Power BI", done: 1, target: 4, minutes: 60 }, { name: "Meditation", done: 3, target: 3, minutes: 45 }], moods: { low: 0, ok: 0, high: 0 }, offDays: 0 });
    expect(power).toMatch(/Power BI fell short \(1 of 4\)/);
    expect(power).toMatch(/you chose to skip it/);
    expect(text).toMatch(/one small change/);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(170);
    expect(text).not.toMatch(/should|failed|lazy|disappoint/i);
  });

  it("trims to whole sentences", () => {
    const long = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} here.`).join(" ");
    const t = trimWords(long, 50);
    expect(t.split(/\s+/).length).toBeLessThanOrEqual(50);
    expect(t.endsWith(".")).toBe(true);
  });

  it("validates what Gemini writes", () => {
    const good = `Dear Sahil, ${"you did well this week and kept showing up. ".repeat(8)}Next week, try one small thing.`;
    expect(cleanLetter(good, "Sahil")).toMatch(/^Dear Sahil/);
    expect(cleanLetter("too short", "Sahil")).toBeNull();
    expect(cleanLetter(42, "Sahil")).toBeNull();
    expect(cleanLetter(`As an AI language model, ${good}`, "Sahil")).toBeNull();
    const noGreeting = cleanLetter("Mixed week but a real one. ".repeat(12), "Sahil")!;
    expect(noGreeting.startsWith("Dear Sahil,")).toBe(true);
    const huge = cleanLetter(`Dear Sahil,\n\n${"A good sentence that goes on a bit. ".repeat(60)}`, "Sahil")!;
    expect(huge.split(/\s+/).length).toBeLessThanOrEqual(160);
    expect(cleanLetter("**Dear Sahil,** " + "you did well this week. ".repeat(10), "Sahil")).not.toContain("*");
  });

  const reply = (obj: unknown, status = 200): Response => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status });

  it("with a key, Gemini writes it; the call carries only the compact summary", async () => {
    const text = `Dear Sahil,\n\n${"You kept meditation going all week and that matters. ".repeat(6)}\n\nNext week, give Power BI one early slot.`;
    const calls: RequestInit[] = [];
    const fetcher: Fetcher = async (_u, init) => {
      calls.push(init);
      return reply({ letter: text });
    };
    const l = await writeLetter(weekData(), TODAY, { useAi: true, fetcher, key: "k", model: "m", now: 5 });
    expect(l).toMatchObject({ source: "ai", week: "2026-10-12", at: 5 });
    expect(l.text.startsWith("Dear Sahil")).toBe(true);
    const body = JSON.parse(calls[0].body as string);
    expect(body.generationConfig.temperature).toBeGreaterThan(0);
    expect(body.contents[0].parts[0].text).toContain('"areas"');
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("without a key, offline or on any error, the rules letter is used", async () => {
    const noKey = await writeLetter(weekData(), TODAY, { useAi: false });
    expect(noKey.source).toBe("rules");
    const down = await writeLetter(weekData(), TODAY, { useAi: true, key: "k", model: "m", fetcher: async () => reply({ error: { message: "no" } }, 500) });
    expect(down.source).toBe("rules");
    const thrown = await writeLetter(weekData(), TODAY, { useAi: true, key: "k", model: "m", fetcher: async () => { throw new TypeError("offline"); } });
    expect(thrown.source).toBe("rules");
    const junk = await writeLetter(weekData(), TODAY, { useAi: true, key: "k", model: "m", fetcher: async () => reply({ letter: "ok" }) });
    expect(junk.source).toBe("rules");
  });

  it("is cached once per week and only the last 12 are kept", () => {
    const d = weekData();
    expect(needsLetter(d, TODAY)).toBe(true);
    const l: CoachLetter = { week: weekStart(TODAY), text: "Dear Sahil", source: "rules", at: 1 };
    const withIt: AppData = { ...d, letters: withLetter(d.letters, l) };
    expect(needsLetter(withIt, TODAY)).toBe(false);
    expect(needsLetter(withIt, addDays(TODAY, -3))).toBe(false); // same week
    expect(needsLetter(withIt, addDays(TODAY, 1))).toBe(true); // next week
    // Writing the same week again replaces, never duplicates.
    expect(withLetter(withIt.letters, { ...l, text: "new" })).toHaveLength(1);
    let all: CoachLetter[] | undefined;
    for (let i = 0; i < 15; i++) all = withLetter(all, { week: addDays("2026-01-05", i * 7), text: `w${i}`, source: "rules", at: i });
    expect(all).toHaveLength(12);
    expect(all![11].text).toBe("w14");
    expect(letterFor(all, addDays("2026-01-05", 14 * 7))?.text).toBe("w14");
  });
});
