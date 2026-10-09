import { describe, expect, it } from "vitest";
import { addDays } from "../lib/dates";
import { applyChoiceToData, buildChoice, planChoice } from "../lib/feeling";
import { planNotifications } from "../lib/notifications/plan";
import { isOffDay } from "../lib/offday";
import { assignDate, isQuoteDay, quoteAtSlot, quoteForDate, quoteStateOf, QUOTE_LIBRARY, slotForDate } from "../lib/quoteBag";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { weekProgress } from "../lib/sessions";
import { buildTimeline } from "../lib/timeline";
import type { AppData, QuoteState, Task } from "../lib/types";

// Tue 6 Oct 2026, 06:30: a whole day ahead.
const NOW = new Date(2026, 9, 6, 6, 30);
const TODAY = "2026-10-06";
let n = 0;
const task = (o: Partial<Task>): Task => ({ id: `s2-${++n}`, title: `Task ${n}`, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, estimateMin: 30, ...o });
const base = (tasks: Task[] = []): AppData => ({ ...seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW), tasks });

describe("How are you feeling? · choose your day", () => {
  it("shows booked things locked and everything flexible with a tick box", () => {
    const d: AppData = {
      ...base([task({ due: TODAY }), task({ due: TODAY, dueTime: "15:00", title: "Fill form" })]),
      events: [{ id: "ev", title: "Dinner", date: TODAY, start: "19:00", end: "21:00", createdAt: 1 }],
    };
    const c = buildChoice(d, NOW, "ok");
    const locked = c.items.filter((i) => i.locked).map((i) => i.title);
    expect(locked).toEqual(expect.arrayContaining(["Dinner", "Fill form"]));
    expect(c.items.some((i) => !i.locked && i.kind === "task")).toBe(true);
    expect(c.items.every((i) => !i.locked || i.ticked)).toBe(true);
    // Locked first.
    const firstFlexible = c.items.findIndex((i) => !i.locked);
    expect(c.items.slice(firstFlexible).every((i) => !i.locked)).toBe(true);
    expect(c.note.length).toBeGreaterThan(10);
  });

  it("pre-ticks fewer on a low day than on a great one", () => {
    const d = base([1, 2, 3, 4, 5, 6, 7, 8].map((i) => task({ due: TODAY, title: `Job ${i}` })));
    const count = (e: "low" | "ok" | "high") => buildChoice(d, NOW, e).items.filter((i) => !i.locked && i.ticked).length;
    expect(count("low")).toBeLessThan(count("ok"));
    expect(count("ok")).toBeLessThan(count("high"));
  });

  it("an explicit hint (what he usually finishes) sets the count and the line", () => {
    const d = base([1, 2, 3, 4, 5].map((i) => task({ due: TODAY, title: `Job ${i}` })));
    const c = buildChoice(d, NOW, "ok", { count: 2, note: "You usually finish about 2 on Tuesdays." });
    expect(c.items.filter((i) => !i.locked && i.ticked)).toHaveLength(2);
    expect(c.note).toBe("You usually finish about 2 on Tuesdays.");
  });

  it("unticked tasks move to a later day with room; ticked ones and booked ones stay", () => {
    const keep = task({ due: TODAY, title: "Keep me" });
    const drop = task({ due: TODAY, title: "Drop me" });
    const d: AppData = { ...base([keep, drop]), events: [{ id: "ev", title: "Dinner", date: TODAY, start: "19:00", end: "21:00", createdAt: 1 }] };
    const c = buildChoice(d, NOW, "ok");
    const ticked = new Set(c.items.filter((i) => i.ticked && i.title !== "Drop me").map((i) => i.key));
    const plan = planChoice(d, NOW, ticked);
    expect(plan.taskMoves.map((m) => m.title)).toEqual(["Drop me"]);
    expect(plan.taskMoves[0].to > TODAY).toBe(true);
    const after = applyChoiceToData(d, plan);
    expect(after.tasks.find((t) => t.id === keep.id)!.due).toBe(TODAY);
    expect(after.tasks.find((t) => t.id === drop.id)!.due).toBe(plan.taskMoves[0].to);
    // The booked event is untouched and still on its day.
    expect(after.events).toEqual(d.events);
    expect(buildTimeline(after, TODAY, NOW).items.some((i) => i.title === "Dinner")).toBe(true);
    expect(plan.summary).toMatch(/^Moved Drop me to /);
  });

  it("moved tasks spread over days instead of piling on one", () => {
    const many = Array.from({ length: 9 }, (_, i) => task({ due: TODAY, estimateMin: 60, title: `Big ${i}` }));
    const d = base(many);
    const plan = planChoice(d, NOW, new Set());
    const days = new Set(plan.taskMoves.map((m) => m.to));
    expect(plan.taskMoves).toHaveLength(9);
    expect(days.size).toBeGreaterThan(1);
  });

  it("unticked sessions are skipped for today and re-planned on other days, still aiming at the weekly target", () => {
    const d = base();
    const todaySessions = buildTimeline(d, TODAY, NOW).items.filter((i) => i.kind === "session" && !i.done);
    expect(todaySessions.length).toBeGreaterThan(0);
    const before = planSessions(d, NOW);
    const plan = planChoice(d, NOW, new Set());
    expect(plan.skips.length).toBeGreaterThanOrEqual(todaySessions.length);
    const after = applyChoiceToData(d, plan);
    const afterPlan = planSessions(after, NOW);
    // Nothing planned for the skipped sessions today.
    for (const s of todaySessions) expect(afterPlan.some((p) => p.areaId === s.areaId && p.date === TODAY && !p.done)).toBe(false);
    // Per area: if the week had room, as many sessions are still planned as before (the target is still the aim).
    for (const row of weekProgress(d, TODAY)) {
      const was = before.filter((p) => p.areaId === row.area.id && !p.done).length;
      const now = afterPlan.filter((p) => p.areaId === row.area.id && !p.done).length;
      expect(now).toBeLessThanOrEqual(was);
      if (was && todaySessions.some((s) => s.areaId === row.area.id)) expect(now).toBeGreaterThanOrEqual(was - 1);
    }
    expect(plan.lines.length).toBeGreaterThan(0);
    expect(plan.summary).toMatch(/Moved /);
  });

  it("the two-off-days rule still holds: moved sessions never land on an off day", () => {
    const off = [addDays(TODAY, 1), addDays(TODAY, 2)];
    const d: AppData = { ...base(), offDays: off };
    const plan = planChoice(d, NOW, new Set());
    const after = applyChoiceToData(d, plan);
    for (const s of planSessions(after, NOW).filter((p) => !p.done && p.date > TODAY)) {
      // An off day keeps at most one short session; it never receives the moved ones in bulk.
      if (isOffDay(after, s.date)) expect(s.minutes).toBeLessThanOrEqual(20);
    }
    for (const t of plan.taskMoves) expect(isOffDay(after, t.to) ? false : true).toBe(true);
  });

  it("a plan that keeps everything changes nothing", () => {
    const d = base([task({ due: TODAY })]);
    const all = new Set(buildChoice(d, NOW, "high").items.map((i) => i.key));
    const plan = planChoice(d, NOW, all);
    expect(plan.movedCount).toBe(0);
    expect(plan.summary).toMatch(/keeping everything/i);
  });
});

describe("the morning notification asks how he feels", () => {
  it("is the new text, at 08:15 on weekdays and 09:30 on weekends, until it has been answered", () => {
    const d = base();
    const list = planNotifications(d, new Date(2026, 9, 6, 6, 0));
    const wk = list.find((x) => x.key === "morning:2026-10-06")!;
    expect(wk.title).toBe("Good morning, Sahil. How are you feeling today?");
    expect(`${wk.at.getHours()}:${String(wk.at.getMinutes()).padStart(2, "0")}`).toBe("8:15");
    const we = list.find((x) => x.key === "morning:2026-10-10")!;
    expect(`${we.at.getHours()}:${String(we.at.getMinutes()).padStart(2, "0")}`).toBe("9:30");
    const answered: AppData = { ...d, checkins: [{ date: "2026-10-06", energy: "ok", ticked: 3, offered: 4, at: 1 }] };
    expect(planNotifications(answered, new Date(2026, 9, 6, 6, 0)).some((x) => x.key === "morning:2026-10-06")).toBe(false);
    expect(planNotifications(answered, new Date(2026, 9, 6, 6, 0)).some((x) => x.key === "morning:2026-10-07")).toBe(true);
  });

  it("can be switched off", () => {
    const d = base();
    const off: AppData = { ...d, profile: { ...d.profile!, notify: { ...d.profile!.notify, morning: false } } };
    expect(planNotifications(off, new Date(2026, 9, 6, 6, 0)).some((x) => x.kind === "morning")).toBe(false);
  });
});

describe("the quote bag", () => {
  const fresh = (): QuoteState => quoteStateOf(base());

  it("walks through every quote before any repeats, alternating English and Hinglish", () => {
    const st = fresh();
    const enN = QUOTE_LIBRARY.en.length;
    const seenEn = new Set<string>();
    const seenHi = new Set<string>();
    for (let slot = 0; slot < enN * 2; slot++) {
      const q = quoteAtSlot(st.seed, slot);
      if (slot % 2 === 0) {
        expect(q.id.startsWith("en")).toBe(true);
        expect(seenEn.has(q.id)).toBe(false);
        seenEn.add(q.id);
      } else if (seenHi.size < QUOTE_LIBRARY.hi.length) {
        expect(q.id.startsWith("hi")).toBe(true);
        expect(seenHi.has(q.id)).toBe(false);
        seenHi.add(q.id);
      }
    }
    expect(seenEn.size).toBe(enN);
    // The first slot of the next round is a fresh shuffle, not the same order.
    expect(quoteAtSlot(st.seed, enN * 2).id.startsWith("en")).toBe(true);
  });

  it("is deterministic: the same date always shows the same quote, however often it is re-planned", () => {
    const st = fresh();
    const a = quoteForDate(st, "2026-10-12", 2, TODAY);
    const b = quoteForDate(st, "2026-10-12", 2, TODAY);
    expect(a.id).toBe(b.id);
    expect(planNotifications(base(), NOW).filter((x) => x.kind === "quote").map((x) => x.body)).toEqual(planNotifications(base(), NOW).filter((x) => x.kind === "quote").map((x) => x.body));
  });

  it("once a date is shown it is pinned, and later dates don't shift", () => {
    let st = fresh();
    st = { ...st, anchor: "2026-10-06" };
    const dates = ["2026-10-06", "2026-10-08", "2026-10-10", "2026-10-12"];
    const planned = dates.map((d) => quoteForDate(st, d, 2, "2026-10-06").id);
    expect(new Set(planned).size).toBe(4);
    const after = assignDate(st, "2026-10-06");
    expect(quoteForDate(after, "2026-10-06", 2, "2026-10-06").id).toBe(planned[0]);
    // The remaining dates keep their quotes after today's has been pinned.
    expect(dates.slice(1).map((d) => quoteForDate(after, d, 2, "2026-10-06").id)).toEqual(planned.slice(1));
    // Assigning twice does nothing.
    expect(assignDate(after, "2026-10-06")).toBe(after);
  });

  it("goes out every N days, alternating languages, and not at all when off", () => {
    const d = base();
    const quotes = planNotifications(d, NOW).filter((x) => x.kind === "quote");
    expect(quotes.length).toBeGreaterThanOrEqual(3);
    const gaps = quotes.slice(1).map((q, i) => Math.round((q.at.getTime() - quotes[i].at.getTime()) / 86_400_000));
    expect(gaps.every((g) => g === 2)).toBe(true);
    expect(quotes[0].at.getHours()).toBe(13);
    expect(quotes[0].at.getMinutes()).toBe(30);
    expect(quotes[0].title).toContain("Sahil");
    const off: AppData = { ...d, profile: { ...d.profile!, quoteEvery: 0 } };
    expect(planNotifications(off, NOW).some((x) => x.kind === "quote")).toBe(false);
    const daily: AppData = { ...d, profile: { ...d.profile!, quoteEvery: 1 } };
    expect(planNotifications(daily, NOW).filter((x) => x.kind === "quote").length).toBeGreaterThan(quotes.length);
  });

  it("never lands in quiet hours", () => {
    const d = base();
    const late: AppData = { ...d, profile: { ...d.profile!, quoteTime: "23:30" } };
    for (const q of planNotifications(late, NOW).filter((x) => x.kind === "quote")) {
      const m = q.at.getHours() * 60 + q.at.getMinutes();
      expect(m >= 7 * 60 + 30 && m < 22 * 60).toBe(true);
    }
  });

  it("isQuoteDay counts from the anchor", () => {
    const st: QuoteState = { ...fresh(), anchor: "2026-10-01" };
    expect([1, 2, 3, 4, 5, 6].map((i) => isQuoteDay(st, `2026-10-0${i}`, 3))).toEqual([true, false, false, true, false, false]);
    expect(slotForDate(st, "2026-10-04", 3, "2026-10-01")).toBe(st.cursor + 1);
  });
});
