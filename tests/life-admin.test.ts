import { describe, expect, it } from "vitest";
import { addLifePack, ensureLifeSeries, LIFE_ITEMS, lifeOn } from "../lib/lifeAdmin";
import { planNotifications } from "../lib/notifications/plan";
import { firstOccurrence, recurLabel } from "../lib/recur";
import { seedIfNeeded } from "../lib/seed";
import { getOccurrences, ruleHits, sweepMissed } from "../lib/series";
import { addCustomSource, allSources, allTicked, checklist, DEFAULT_WEEKLY, inSeason, searchUrl, setTick, slug, thisWeeksFive, toggleHidden, toggleWeekly, weeklySources } from "../lib/sideWork";
import { withHistory } from "../lib/history";
import { understand } from "../lib/understand";
import type { AppData } from "../lib/types";

// Mon 12 Oct 2026, 08:00.
const NOW = new Date(2026, 9, 12, 8, 0);
const TODAY = "2026-10-12";
const seeded = (over: Partial<AppData> = {}): AppData => seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() }, ...over }, NOW);
const life = (d: AppData, id: string) => d.series!.find((s) => s.lifeId === id)!;

describe("5. the 'Nth weekday of the month' rule", () => {
  const first = { freq: "monthly" as const, interval: 1, weekdays: [6], nth: 1 };
  const last = { freq: "monthly" as const, interval: 1, weekdays: [0], nth: -1 };
  it("1st Saturday", () => {
    expect(["2026-10-03", "2026-11-07", "2026-12-05"].every((d) => ruleHits(first, "2026-10-03", d))).toBe(true);
    expect(ruleHits(first, "2026-10-03", "2026-10-10")).toBe(false);
    expect(firstOccurrence(first, "2026-10-12")).toBe("2026-11-07");
    expect(recurLabel(first)).toBe("Monthly, 1st Sat");
  });
  it("last Sunday", () => {
    expect(["2026-10-25", "2026-11-29", "2026-12-27"].every((d) => ruleHits(last, "2026-10-25", d))).toBe(true);
    expect(ruleHits(last, "2026-10-25", "2026-11-22")).toBe(false);
    expect(firstOccurrence(last, "2026-10-12")).toBe("2026-10-25");
    expect(recurLabel(last)).toBe("Monthly, last Sun");
  });
  it("every 3 months counts from where it starts", () => {
    const q = { freq: "monthly" as const, interval: 3, monthDay: 1 };
    expect(ruleHits(q, "2026-11-01", "2027-02-01")).toBe(true);
    expect(ruleHits(q, "2026-11-01", "2026-12-01")).toBe(false);
  });
});

describe("5. the life admin pack", () => {
  const d = seeded();

  it("adds all the items, all on, in the Life area, with fixed ids", () => {
    const mine = d.series!.filter((s) => s.lifeId);
    expect(mine).toHaveLength(LIFE_ITEMS.length);
    expect(mine.every((s) => !s.off && s.area === "life" && !s.time && s.id === `life-${s.lifeId}`)).toBe(true);
    expect(d.profile!.areas.map((a) => a.id)).toEqual(expect.arrayContaining(["life", "sidework"]));
    const day = (id: string) => getOccurrences(d, TODAY, "2026-12-31", TODAY).filter((o) => o.series.lifeId === id).map((o) => o.date);
    expect(day("side-work")[0]).toBe("2026-10-12"); // Monday
    expect(day("laundry")[0]).toBe("2026-10-14"); // Wednesday
    expect(day("cv")[0]).toBe("2026-10-15"); // Thursday
    expect(day("bedsheets").slice(0, 2)).toEqual(["2026-10-18", "2026-11-01"]); // every 2 weeks, Sunday
    expect(day("budget")[0]).toBe("2026-11-07"); // 1st Saturday
    expect(day("deep-clean").slice(0, 2)).toEqual(["2026-10-25", "2026-11-29"]); // last Sunday
    expect(day("haircut").slice(0, 2)).toEqual(["2026-10-17", "2026-11-21"]); // every 5 weeks
  });

  it("does not duplicate the chores you already have (Clean room, Grocery run, Finance review, Call family)", () => {
    const titles = d.series!.map((s) => s.title.toLowerCase());
    for (const t of ["clean room", "grocery", "finance review", "call family"]) expect(titles.some((x) => x.includes(t))).toBe(false);
    expect((d.bills ?? []).filter((b) => /clean room|grocery|finance review|call family/i.test(b.name))).toHaveLength(4);
  });

  it("is idempotent: adding it again changes nothing, and a switched-off item stays off", () => {
    expect(addLifePack(d, TODAY).series).toHaveLength(d.series!.length);
    const off = { ...d, series: d.series!.map((s) => (s.lifeId === "laundry" ? { ...s, off: true } : s)) };
    expect(lifeOn(off, "laundry")).toBe(false);
    expect(addLifePack(off, TODAY).series!.find((s) => s.lifeId === "laundry")!.off).toBe(true);
    expect(getOccurrences(off, TODAY, "2026-10-31", TODAY).some((o) => o.series.lifeId === "laundry")).toBe(false);
    // Deleted from Repeating tasks, then switched on again in Settings: it comes back.
    const gone = { ...d, series: d.series!.filter((s) => s.lifeId !== "laundry") };
    expect(lifeOn(ensureLifeSeries(gone, "laundry", TODAY), "laundry")).toBe(true);
  });

  it("a missed one rolls forward ONCE, then drops with a history entry", () => {
    // Laundry is Wednesday 14 Oct; it is not done.
    const thu = "2026-10-15";
    const fri = "2026-10-16";
    const on = (day: string) => getOccurrences(d, "2026-10-14", day, day).find((o) => o.series.lifeId === "laundry" && o.date === "2026-10-14")!;
    expect(on("2026-10-14").status).toBe("open");
    expect(on(thu)).toMatchObject({ status: "open", carried: true });
    // Friday: it has rolled forward once already, so it is dropped.
    expect(on(fri)).toMatchObject({ status: "missed", carried: false });
    // An ordinary repeat keeps carrying its latest missed day; life admin does not.
    const swept = sweepMissed(d, fri);
    expect(swept.occurrences!.find((r) => r.key === "life-laundry@2026-10-14")?.status).toBe("missed");
    const withLog = withHistory(d, swept, new Date(2026, 9, 16, 8, 0).getTime());
    expect(withLog.history!.some((e) => e.kind === "missed" && e.title === "Laundry" && e.date === "2026-10-14")).toBe(true);
  });

  it("sends ONE reminder at 19:00, only for an item still open that day", () => {
    const l = planNotifications(d, NOW, { budget: Infinity }).filter((n) => n.kind === "life");
    const laundry = l.find((n) => n.key === "life:life-laundry@2026-10-14")!;
    expect([laundry.at.getHours(), laundry.at.getMinutes()]).toEqual([19, 0]);
    expect(laundry.title).toBe("Laundry");
    expect(l.filter((n) => n.title === "Laundry" && n.at.getDate() === 14)).toHaveLength(1);
    // Done today: no reminder at 19:00.
    const done = { ...d, occurrences: [{ key: "life-laundry@2026-10-14", seriesId: "life-laundry", date: "2026-10-14", status: "done" as const, doneAt: 1 }] };
    expect(planNotifications(done, NOW, { budget: Infinity }).some((n) => n.key === "life:life-laundry@2026-10-14")).toBe(false);
    // Switched off: none.
    const off = { ...d, series: d.series!.map((s) => (s.lifeId === "laundry" ? { ...s, off: true } : s)) };
    expect(planNotifications(off, NOW, { budget: Infinity }).some((n) => n.title === "Laundry")).toBe(false);
  });
});

describe("5. typing 'remind me every Wednesday to …'", () => {
  const d = seeded();
  it("makes a weekly series in the Life area, with a clean title", () => {
    const p = understand("remind me every Wednesday to water the plants", d, NOW);
    expect(p.recur).toEqual({ freq: "weekly", interval: 1, weekdays: [3] });
    expect(p.title).toBe("Water the plants");
    expect(p.area).toBe("life");
    expect(p.due).toBe("2026-10-14");
  });
  it("an area you typed wins, and an ordinary 'weekly report' is not a life reminder", () => {
    expect(understand("remind me every Wednesday to water the plants @home", d, NOW).area).toBe("home");
    expect(understand("remind me to send the weekly report", d, NOW).area).not.toBe("life");
  });
});

describe("5. side work", () => {
  const d = seeded();

  it("the sources are data: the groups from the brief, each a search for \"<name> London jobs\"", () => {
    const all = allSources(d);
    // 5 + 8 + 17 + 23 + 14 + 9 + 8 + 6 + 7 + 7 sources in the ten groups of the brief.
    expect(all).toHaveLength(104);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(searchUrl("Unitemps")).toBe("https://www.google.com/search?q=%22Unitemps%20London%20jobs%22");
    expect(allSources(d).find((s) => s.name === "Pinnacle Event Staff (LiveForce)")).toBeTruthy();
    expect(new Set(all.map((s) => s.groupName))).toEqual(new Set(["Uni & casual banks", "Shift apps", "Events & venues", "Christmas & seasonal", "Finance & office temp (uses my AP / Power BI skills)", "General agencies", "Job boards", "Freelance (Power BI / Excel / data)", "Paid research & testing", "Gig & local"]));
  });

  it("Every week starts as King's Talent Bank, Unitemps and Pinnacle", () => {
    expect(weeklySources(d).map((s) => s.name)).toEqual(["King's Talent Bank", "Unitemps", "Pinnacle Event Staff (LiveForce)"]);
    expect(DEFAULT_WEEKLY).toHaveLength(3);
  });

  it("this week's 5 rotate week by week, and never repeat Every week", () => {
    const wk = (n: number) => thisWeeksFive(d, `2026-${n < 10 ? "0" : ""}${n}-01`);
    const a = thisWeeksFive(d, "2026-10-12");
    const b = thisWeeksFive(d, "2026-10-19");
    expect(a).toHaveLength(5);
    expect(a.map((s) => s.id)).not.toEqual(b.map((s) => s.id));
    expect(a.some((s) => DEFAULT_WEEKLY.includes(s.id))).toBe(false);
    void wk;
  });

  it("from 15 Oct to 15 Dec the Christmas & seasonal group comes first; outside it, it is left out", () => {
    expect(inSeason("2026-10-14")).toBe(false);
    expect(inSeason("2026-10-15")).toBe(true);
    expect(inSeason("2026-12-15")).toBe(true);
    expect(inSeason("2026-12-16")).toBe(false);
    for (const day of ["2026-10-19", "2026-11-09", "2026-12-07"]) expect(thisWeeksFive(d, day).filter((s) => s.seasonal).length, day).toBe(3);
    for (const day of ["2026-03-02", "2026-07-06"]) expect(thisWeeksFive(d, day).some((s) => s.seasonal), day).toBe(false);
  });

  it("star, hide and add your own", () => {
    const x = allSources(d).find((s) => s.name === "Indeed Flex")!;
    const starred = toggleWeekly(d, x.id);
    expect(weeklySources(starred).map((s) => s.id)).toContain(x.id);
    expect(thisWeeksFive(starred, "2026-10-19").some((s) => s.id === x.id)).toBe(false);
    const hidden = toggleHidden(d, x.id);
    expect(thisWeeksFive(hidden, "2026-10-19").some((s) => s.id === x.id)).toBe(false);
    expect(allSources(hidden).some((s) => s.id === x.id)).toBe(true); // still in All sources
    const mine = addCustomSource(d, "  My cousin's café  ");
    expect(allSources(mine).find((s) => s.custom)?.name).toBe("My cousin's café");
    expect(addCustomSource(mine, "my cousin's café").sideWork!.custom).toHaveLength(1);
    expect(slug("Lord's (MCC) matchday")).toBe("lord-s-mcc-matchday");
  });

  it("ticking the whole check is what counts as done", () => {
    const list = checklist(d, "2026-10-12");
    expect(list).toHaveLength(8);
    let cur = d;
    for (const s of list.slice(0, 7)) cur = setTick(cur, "2026-10-12", s.id, true);
    expect(allTicked(cur, "2026-10-12")).toBe(false);
    cur = setTick(cur, "2026-10-12", list[7].id, true);
    expect(allTicked(cur, "2026-10-12")).toBe(true);
    // Another week starts unticked.
    expect(allTicked(cur, "2026-10-19")).toBe(false);
  });
});
