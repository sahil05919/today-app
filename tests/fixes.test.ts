import { describe, expect, it } from "vitest";
import { migrate } from "../lib/backup";
import { addDays } from "../lib/dates";
import { planNotifications } from "../lib/notifications/plan";
import { makeSeries } from "../lib/series";
import { buildTimeline } from "../lib/timeline";
import { upcomingDays } from "../lib/upcoming";
import type { AppData, Series } from "../lib/types";

// Mon 12 Oct 2026, 10:00 London: the 11:00 vitamin is still open today.
const NOW = new Date(2026, 9, 12, 10, 0);
const TODAY = "2026-10-12";
const DAILY = { freq: "daily" as const, interval: 1 };

const vitamin = (over: Partial<Parameters<typeof makeSeries>[0]> = {}): Series => makeSeries({ id: "vit", title: "All Vitamin", time: "11:00", rule: DAILY, from: TODAY, createdAt: 1, ...over });
const data = (series: Series[], extra: Partial<AppData> = {}): AppData => ({ version: 2, tasks: [], settings: { firstRunAt: 1 }, series, ...extra });

describe("1a. no phantom 18:00 vitamin", () => {
  const d = data([vitamin()]);

  it("Coming up shows ONE vitamin a day, at 11:00, never an evening copy", () => {
    for (const u of upcomingDays(d, TODAY, 5, 8)) {
      const v = u.top.filter((t) => /Vitamin/.test(t.title));
      expect(v, u.date).toHaveLength(1);
      expect(v[0].time, u.date).toBe("11:00");
      expect(v[0].item.carried, u.date).toBeFalsy();
    }
  });

  it("a future day never carries today's open occurrence over", () => {
    for (let i = 1; i <= 4; i++) {
      const day = addDays(TODAY, i);
      // Seen the way the app asks for it: the day's own start, with today named explicitly.
      const tl = buildTimeline(d, day, new Date(`${day}T00:00:00`), { today: TODAY });
      expect(tl.items.filter((x) => x.title === "All Vitamin").map((x) => [x.start, x.fixed])).toEqual([[11 * 60, true]]);
      expect(tl.stillTodo).toHaveLength(0);
    }
  });

  it("and the old call shape (no real today) is what produced the evening copy", () => {
    // Documents the root cause: with `now` = tomorrow's midnight, today's open vitamin is "overdue" from tomorrow's view.
    const tl = buildTimeline(d, addDays(TODAY, 1), new Date(`${addDays(TODAY, 1)}T00:00:00`));
    expect(tl.items.filter((x) => x.title === "All Vitamin").length + tl.stillTodo.length).toBeGreaterThan(1);
  });

  it("exactly one 11:00 reminder per day", () => {
    const list = planNotifications(d, NOW).filter((n) => n.kind === "reminder" && /Vitamin/.test(n.title) && !n.key.includes(":nag"));
    const perDay = new Map<string, number>();
    for (const n of list) perDay.set(n.at.toDateString(), (perDay.get(n.at.toDateString()) ?? 0) + 1);
    expect([...perDay.values()].every((c) => c === 1)).toBe(true);
    expect(list.every((n) => n.at.getHours() === 11 && n.at.getMinutes() === 0)).toBe(true);
  });
});

describe("a per-occurrence time survives a reload (the regex in migrate lost it)", () => {
  it("keeps an 18:00 override", () => {
    const d = data([vitamin()], { occurrences: [{ key: "vit@2026-10-14", seriesId: "vit", date: "2026-10-14", time: "18:00" }] });
    const back = migrate(JSON.parse(JSON.stringify(d)));
    expect(back.occurrences?.find((r) => r.date === "2026-10-14")?.time).toBe("18:00");
  });
});

describe("1a. dedupe: one series, one 11:00 notification a day", () => {
  const copy = (id: string, over: Partial<Series> = {}): Series => ({ ...vitamin({ id }), createdAt: id === "vit" ? 1 : 2, ...over });

  it("merges a copy with the same title + area + rule into the oldest, keeping done records", () => {
    const d = data([copy("vit"), copy("vit-copy", { time: undefined })], {
      occurrences: [
        { key: "vit@2026-10-10", seriesId: "vit", date: "2026-10-10", status: "done", doneAt: 5 },
        { key: "vit-copy@2026-10-10", seriesId: "vit-copy", date: "2026-10-10" },
        { key: "vit-copy@2026-10-11", seriesId: "vit-copy", date: "2026-10-11", status: "done", doneAt: 9, time: "" },
      ],
    });
    const clean = migrate(JSON.parse(JSON.stringify(d)));
    expect(clean.series).toHaveLength(1);
    expect(clean.series![0]).toMatchObject({ id: "vit", time: "11:00" });
    expect(clean.occurrences!.map((r) => [r.key, r.status, r.time]).sort()).toEqual([
      ["vit@2026-10-10", "done", undefined],
      ["vit@2026-10-11", "done", undefined],
    ]);
  });

  it("leaves two different times alone (two daily doses is a choice, not a copy)", () => {
    const d = data([copy("vit"), copy("evening", { time: "18:00" })]);
    expect(migrate(JSON.parse(JSON.stringify(d))).series).toHaveLength(2);
  });

  it("leaves a series that continues an ended one alone", () => {
    const d = data([copy("vit", { until: "2026-10-20" }), copy("later", { startDate: "2026-10-21", anchor: "2026-10-21" })]);
    expect(migrate(JSON.parse(JSON.stringify(d))).series).toHaveLength(2);
  });

  it("is idempotent, and the duplicate no longer adds an 18:00 or a second reminder", () => {
    const d = data([copy("vit"), copy("vit-copy", { time: undefined })]);
    const once = migrate(JSON.parse(JSON.stringify(d)));
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    const tl = buildTimeline(once, TODAY, NOW);
    expect(tl.items.filter((x) => /Vitamin/.test(x.title))).toHaveLength(1);
  });
});

describe("1c. a typed command is never a task", () => {
  it("removes 'Can you take out some work from future and adjust in' and 'work done' from the tasks", () => {
    const task = (id: string, title: string) => ({ id, title, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1 });
    const raw = { version: 2, settings: { firstRunAt: 1 }, tasks: [task("a", "Can you take out some work from future and adjust in"), task("b", "Work done"), task("c", "Call the bank")] };
    expect(migrate(raw).tasks.map((t) => t.title)).toEqual(["Call the bank"]);
  });
});
