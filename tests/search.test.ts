import { describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { catCtx } from "../lib/categorise";
import { addDays, toISO } from "../lib/dates";
import { buildEntries } from "../lib/entries";
import { parseQuery, QUICK_CHIPS } from "../lib/query";
import { search } from "../lib/search";
import { seedIfNeeded } from "../lib/seed";
import { weekStart } from "../lib/stats";
import { weekStats } from "../lib/weekly";
import { jarBetween } from "../lib/winjar";
import { learnFix } from "../lib/learn";
import type { AppData, HistoryEvent, SessionLog, Task } from "../lib/types";

const NOW = new Date(2026, 9, 14, 12, 0); // Wed 14 Oct 2026, 12:00
const TODAY = toISO(NOW);
const MONDAY = weekStart(TODAY); // 2026-10-12
let n = 0;
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });
const session = (areaId: string, date: string, minutes = 60): SessionLog => ({ id: `s${++n}`, areaId, date, minutes, n, at: new Date(`${date}T19:00:00`).getTime(), source: "manual" });
const task = (o: Partial<Task>): Task => ({ id: `t${++n}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: n, ...o });
const q = (text: string, d: AppData = base()) => parseQuery(text, catCtx(d), TODAY);

describe("parseQuery: area, time and intent", () => {
  const cases: Array<[string, { area?: string; sub?: string; kind: string; intents?: string[]; words?: string[] }]> = [
    ["pbi", { area: "powerbi", kind: "week" }],
    ["Power BI this week", { area: "powerbi", kind: "week" }],
    ["pbi last week", { area: "powerbi", kind: "lastWeek" }],
    ["walk", { area: "walking", kind: "week" }],
    ["how many walks this month", { area: "walking", kind: "month", intents: ["howMany"] }],
    ["chalna", { area: "walking", kind: "week" }],
    ["aaj chalna", { area: "walking", kind: "today" }],
    ["padhai", { area: "english", kind: "week" }],
    ["meditation yesterday", { area: "meditation", kind: "yesterday" }],
    ["dhyan is hafte", { area: "meditation", kind: "week" }],
    ["gym last month", { area: "health", kind: "lastMonth" }],
    ["other this month", { area: "others", kind: "month" }],
    ["building this month", { area: "others", sub: "Building", kind: "month" }],
    ["what's left this week", { kind: "week", intents: ["left"] }],
    ["missed this week", { kind: "week", intents: ["missed"] }],
    ["skipped walks", { area: "walking", kind: "week", intents: ["skipped"] }],
    ["next pbi session", { area: "powerbi", kind: "week", intents: ["next"] }],
    ["pbi streak", { area: "powerbi", kind: "week", intents: ["streak"] }],
    ["how many hours of pbi in october", { area: "powerbi", kind: "monthName", intents: ["howMany", "time"] }],
    ["walks last 30 days", { area: "walking", kind: "lastDays" }],
    ["finance this year", { area: "finance", kind: "year" }],
    ["added by app", { kind: "week", intents: ["auto"] }],
    ["from gmail", { kind: "week", intents: ["gmail"] }],
    ["hmrc letter", { area: "others", sub: "Admin", kind: "week" }],
    ["passport renewal", { kind: "week", words: ["passport", "renewal"] }],
    ["zorp", { kind: "week", words: ["zorp"] }],
  ];
  it.each(cases)("%s", (text, want) => {
    const p = q(text);
    if (want.area !== undefined) expect(p.area?.area).toBe(want.area);
    if (want.sub) expect(p.area?.sub).toBe(want.sub);
    expect(p.range.kind).toBe(want.kind);
    for (const i of want.intents ?? []) expect(p.intents).toContain(i);
    for (const w of want.words ?? []) expect(p.words).toContain(w);
  });

  it("time words give the right days", () => {
    expect(q("pbi today").range).toMatchObject({ from: TODAY, to: TODAY });
    expect(q("pbi yesterday").range).toMatchObject({ from: "2026-10-13", to: "2026-10-13" });
    expect(q("pbi this week").range).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(q("pbi last week").range).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(q("pbi this month").range).toMatchObject({ from: "2026-10-01", to: TODAY });
    expect(q("pbi last month").range).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(q("pbi september").range).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(q("pbi november").range).toMatchObject({ from: "2025-11-01", to: "2025-11-30" }); // not yet this year
    expect(q("pbi this year").range).toMatchObject({ from: "2026-01-01", to: TODAY });
    expect(q("pbi last 30 days").range).toMatchObject({ from: addDays(TODAY, -29), to: TODAY });
    expect(q("pbi").range.explicit).toBe(false);
  });

  it("your learned rules and area names count too", () => {
    const d = base({ learned: learnFix(undefined, "zorp", { areaId: "finance" }) });
    expect(q("zorp", d).area?.area).toBe("finance");
    expect(q("side work this week", d).area?.area).toBe("sidework");
  });

  it("an empty query has chips, and every chip is a query that finds an area or an intent", () => {
    expect(QUICK_CHIPS.map((c) => c.label)).toEqual(expect.arrayContaining(["Power BI this week", "Walks this month", "What's left this week", "Missed this week", "Other this month"]));
    for (const c of QUICK_CHIPS) {
      const p = q(c.query);
      expect(Boolean(p.area) || p.intents.length > 0).toBe(true);
    }
    expect(search(base(), "  ", NOW).empty).toBe(true);
  });
});

describe("the answer card agrees with the weekly review", () => {
  // Mon–Tue of this week: 2 Power BI sessions (60 min) and 1 walk; the week before 3 Power BI; one Power BI miss this week.
  const history: HistoryEvent[] = [
    { id: "m1", at: new Date(2026, 9, 13, 21).getTime(), date: "2026-10-13", kind: "missed", type: "session", key: "session:powerbi:2026-10-13", title: "Power BI", area: "powerbi", createdByMe: false },
  ];
  const d = base({
    sessions: [session("powerbi", "2026-10-12"), session("powerbi", "2026-10-13"), session("walking", "2026-10-12", 35), session("powerbi", "2026-10-06"), session("powerbi", "2026-10-07"), session("powerbi", "2026-10-08"), session("walking", "2026-10-02", 35)],
    history,
  });

  it("Power BI, this week: done of target is exactly the review's row", () => {
    const row = weekStats(d, MONDAY, TODAY).areas.find((a) => a.id === "powerbi")!;
    const r = search(d, "pbi", NOW);
    expect(r.answer?.title).toBe("Power BI — this week");
    expect(r.answer?.lines[0]).toContain(`${row.done} of ${row.target} done, ${row.target - row.done} left`);
    expect(row.done).toBe(2);
    // The month line uses the win jar's numbers.
    const month = jarBetween(d, "2026-10-01", TODAY).sessions.powerbi;
    expect(r.answer?.lines.some((l) => l.startsWith(`This month: ${month} sessions · 5h`))).toBe(true);
    expect(r.answer?.lines).toContain("Missed: 1.");
    expect(r.answer?.lines.some((l) => l.startsWith("Best streak: 3 days"))).toBe(true);
  });

  it("how many walks this month leads with the number", () => {
    const r = search(d, "how many walks this month", NOW);
    expect(r.answer?.lead).toBe("2 walks");
    expect(r.answer?.lines[0]).toMatch(/^This month: 2 walks · 1h 10m/);
  });

  it("last week uses last week's row; missed leads when asked", () => {
    const row = weekStats(d, "2026-10-05", TODAY).areas.find((a) => a.id === "powerbi")!;
    expect(search(d, "pbi last week", NOW).answer?.lines[0]).toBe(`Last week: ${row.done} of ${row.target} done.`);
    expect(search(d, "how many pbi missed this week", NOW).answer?.lead).toBe("1 missed");
  });

  it("Other: total time and the breakdown come from the same list as the review", () => {
    const d2 = base({
      tasks: [task({ title: "Deploy the app", status: "done", completedAt: new Date(2026, 9, 13, 10).getTime(), estimateMin: 120 }), task({ title: "Fill the council form", status: "done", completedAt: new Date(2026, 9, 14, 9).getTime(), estimateMin: 30 })],
      worklog: [{ id: "w1", date: "2026-10-12", minutes: 60, title: "Cleaning", sub: "Chores", at: 1 }],
    });
    const r = search(d2, "other this week", NOW);
    expect(r.answer?.lines[0]).toContain("3h 30m");
    expect(r.answer?.lines[1]).toContain("Building 2h");
    expect(r.answer?.lines[1]).toContain("Admin 30m");
    expect(r.answer?.lines[1]).toContain("Chores 1h");
  });
});

describe("the lists and free text", () => {
  const d = base({
    tasks: [
      task({ id: "a", title: "Renew passport", due: "2026-10-16", notes: "Needs the old one" }),
      task({ id: "b", title: "Reply to Pinnacle", status: "done", completedAt: new Date(2026, 9, 13, 9).getTime(), notes: "From Gmail: Shift on 24 Oct" }),
      task({ id: "c", title: "Pay the rent", due: "2026-10-01", status: "done", completedAt: new Date(2026, 9, 1, 9).getTime() }),
    ],
    learnings: [{ id: "l1", date: "2026-09-20", areaId: "powerbi", text: "Use CALCULATE to change filter context", at: 1 }],
    notes: [{ id: "n1", at: 1, date: "2026-10-02", text: "the reminder feels too early" }],
    sessions: [session("powerbi", "2026-10-13")],
  });

  it("free text finds tasks (title and notes), Gmail tasks, the learning log and app notes, in any week, with the words marked", () => {
    expect(search(d, "passport", NOW).groups[0].hits[0].entry.title).toBe("Renew passport");
    expect(search(d, "old one", NOW).groups[0].hits[0].entry.title).toBe("Renew passport");
    expect(search(d, "pinnacle", NOW).groups[0].hits[0].entry.src).toBe("gmail-task");
    expect(search(d, "calculate", NOW).groups[0].hits[0].entry.kind).toBe("learning");
    expect(search(d, "feels too early", NOW).groups[0].hits[0].entry.kind).toBe("note");
    expect(search(d, "rent this month", NOW).groups.flatMap((g) => g.hits).map((h) => h.entry.title)).toContain("Pay the rent");
    const hit = search(d, "passport", NOW).groups[0].hits[0];
    expect(hit.marks).toEqual([[6, 14]]);
  });

  it("an area query lists upcoming, done and missed, grouped, newest first", () => {
    const r = search(d, "pbi this week", NOW);
    expect(r.groups.map((g) => g.id)).toContain("done");
    expect(r.groups.find((g) => g.id === "done")!.hits[0].entry.kind).toBe("session");
  });

  it("left shows only what is still to do", () => {
    const r = search(d, "what's left this week", NOW);
    expect(r.groups.map((g) => g.id)).toEqual(["upcoming"]);
    expect(r.groups[0].hits.map((h) => h.entry.title)).toContain("Renew passport");
    expect(r.answer?.lead).toMatch(/left$/);
  });

  it("'added by app' and 'from gmail' list what the app did", () => {
    const withAuto = base({
      auto: [
        { id: "x1", at: NOW.getTime(), src: "gmail-task", kind: "added", key: "task:a", title: "Reply to Pinnacle", reviewed: false },
        { id: "x2", at: NOW.getTime(), src: "phone-calendar", kind: "added", key: "event:z", title: "Dentist", reviewed: false },
        { id: "x3", at: NOW.getTime(), src: "gmail-shift", kind: "added", key: "event:y", title: "Shift", reviewed: true, removed: true },
      ],
    });
    expect(search(withAuto, "added by app", NOW).auto.map((e) => e.id)).toEqual(["x1", "x2"]);
    expect(search(withAuto, "from gmail", NOW).auto.map((e) => e.id)).toEqual(["x1"]);
  });
});

describe("speed", () => {
  it("six months of history: a search is under 100 ms once the index is built", () => {
    const sessions: SessionLog[] = [];
    const history: HistoryEvent[] = [];
    const tasks: Task[] = [];
    const titles = ["call mum", "pay rent", "pbi dashboard", "laundry", "deploy the website", "read a book", "gym", "fill the form", "zorp thing"];
    for (let i = 0; i < 180; i++) {
      const day = addDays(TODAY, -i);
      sessions.push(session("powerbi", day), session("walking", day, 35));
      for (let k = 0; k < 4; k++) {
        const t = task({ id: `p${i}-${k}`, title: `${titles[(i + k) % titles.length]} ${i}`, status: "done", completedAt: new Date(`${day}T10:00:00`).getTime() });
        tasks.push(t);
        history.push({ id: `h${i}-${k}`, at: t.completedAt!, date: day, kind: "done", type: "task", key: `task:${t.id}`, title: t.title, createdByMe: true });
      }
    }
    const d = base({ sessions, history, tasks });
    const built = performance.now();
    buildEntries(d, TODAY);
    const buildMs = performance.now() - built;
    const t0 = performance.now();
    for (const text of ["pbi", "how many walks this month", "passport", "other last month", "dashboard 12"]) search(d, text, NOW);
    const per = (performance.now() - t0) / 5;
    expect(per).toBeLessThan(100);
    expect(buildMs).toBeLessThan(3000);
  });
});
