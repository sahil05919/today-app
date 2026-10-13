import { describe, expect, it } from "vitest";
import { catKey, categorise, dictionaryGuess, type CatCtx } from "../lib/categorise";
import { subFromText } from "../lib/catDict";
import { learnFix } from "../lib/learn";
import { guessSub } from "../lib/other";

const AREAS = ["powerbi", "meditation", "job", "english", "walking", "work", "career", "health", "learning", "home", "shopping", "finance", "family", "travel", "admin", "fun", "notes", "life", "sidework", "others"];
const ctx = (extra: Partial<CatCtx> = {}): CatCtx => ({ areas: new Set(AREAS), names: { sidework: "Side work", powerbi: "Power BI", others: "Others" }, ...extra });

const area = (title: string, extra: Partial<CatCtx> = {}) => categorise({ title }, ctx(extra));

describe("the dictionary (English + Hinglish)", () => {
  it.each([
    ["finish the pbi dashboard", "powerbi"],
    ["Power BI session", "powerbi"],
    ["learn DAX measures", "powerbi"],
    ["power query practice", "powerbi"],
    ["report", "powerbi"], ["fix the sales report visuals", "powerbi"],
    ["meditate", "meditation"],
    ["dhyan 10 min", "meditation"],
    ["breathing exercise", "meditation"],
    ["STAR stories", "job"],
    ["mock interview", "job"],
    ["leetcode two sum", "job"],
    ["sql practice", "job"],
    ["apply to 3 jobs", "job"],
    ["linkedin apply", "job"],
    ["read a book", "english"],
    ["article on pricing", "english"],
    ["kitab padhna", "english"],
    ["aaj chalna hai", "walking"],
    ["evening stroll", "walking"],
    ["went for a walk", "walking"],
    ["steps target", "walking"],
    ["gym", "health"],
    ["book dentist", "health"],
    ["take vitamins", "health"],
    ["dawai leni hai", "health"],
    ["pay the rent", "finance"],
    ["credit card bill", "finance"],
    ["budget review", "finance"],
    ["call mum", "family"],
    ["papa ko call", "family"],
    ["laundry", "life"],
    ["kapde dhona", "life"],
    ["buy sabzi", "life"],
    ["iron shirts", "life"],
    ["clean the kitchen", "life"],
    ["pinnacle shift", "sidework"],
    ["unitemps timesheet", "sidework"],
  ])("%s → %s", (title, want) => {
    expect(area(title).area).toBe(want);
  });

  it("Other gets a sub-label", () => {
    expect(area("deploy the website")).toMatchObject({ area: "others", sub: "Building", how: "dictionary", conf: "medium" });
    expect(area("send the form to council")).toMatchObject({ area: "others", sub: "Admin" });
    expect(area("hmrc letter")).toMatchObject({ area: "others", sub: "Admin" });
    expect(area("udemy course")).toMatchObject({ area: "others", sub: "Learning" });
    expect(area("study for exam")).toMatchObject({ area: "others", sub: "Learning" });
  });

  it("matches whole words, plurals and any case", () => {
    expect(area("Dashboards").area).toBe("powerbi");
    expect(area("REPORTS").area).toBe("powerbi");
    expect(area("walks").area).toBe("walking");
    expect(area("vitamin").area).toBe("health");
    expect(area("chocolate application form").area).not.toBe("walking");
    // "app" is a word, "apple" and "happy" are not.
    expect(dictionaryGuess("apple", ctx())).toBeNull();
    expect(area("build the app").sub).toBe("Building");
    expect(subFromText("happy")).toBe("Other");
    expect(guessSub("hmrc")).toBe("Admin");
  });

  it("padhai is reading, unless it is about a course or an exam", () => {
    expect(area("padhai").area).toBe("english");
    expect(area("exam ki padhai")).toMatchObject({ area: "others", sub: "Learning" });
  });

  it("nothing known is Other / Other with low confidence", () => {
    expect(area("zxqv")).toEqual({ area: "others", sub: "Other", conf: "low", how: "fallback" });
  });
});

describe("the priority order", () => {
  const rules = learnFix(undefined, "gym", { areaId: "walking" }); // a (silly) learned rule that disagrees with the dictionary

  it("1. explicit beats everything", () => {
    expect(categorise({ title: "gym", area: "finance" }, ctx({ rules }))).toMatchObject({ area: "finance", how: "explicit", conf: "high" });
    expect(categorise({ title: "gym #job" }, ctx({ rules }))).toMatchObject({ area: "job", how: "explicit" });
    expect(categorise({ title: "gym", tags: ["pbi"] }, ctx({ rules }))).toMatchObject({ area: "powerbi", how: "explicit" });
    expect(categorise({ title: "Reply", notes: "From Gmail: x\narea: Side work" }, ctx())).toMatchObject({ area: "sidework", how: "explicit" });
    expect(categorise({ key: "task:1", title: "gym", area: "finance" }, ctx({ picks: { "task:1": { area: "family", at: 1 } } }))).toMatchObject({ area: "family", how: "explicit" });
  });

  it("2. inherited beats learned and the dictionary", () => {
    expect(categorise({ title: "gym", area: "powerbi", inherited: true }, ctx({ rules }))).toMatchObject({ area: "powerbi", how: "inherited", conf: "high" });
  });

  it("3. a learned rule beats the dictionary", () => {
    expect(area("gym", { rules })).toMatchObject({ area: "walking", how: "learned", conf: "high" });
    expect(area("gym")).toMatchObject({ area: "health", how: "dictionary" });
  });

  it("3. learning keeps the key words, drops stop-words, and teaches a sub-label for Other", () => {
    const r = learnFix(undefined, "Go to the gym", { areaId: "others", sub: "Building" });
    expect(r[0].words).toEqual(["go", "gym"]);
    expect(area("morning gym", { rules: learnFix(undefined, "gym", { areaId: "health" }) }).how).toBe("learned");
    expect(categorise({ title: "app work" }, ctx({ rules: learnFix(undefined, "app work", { areaId: "others", sub: "Chores" }) }))).toMatchObject({ area: "others", sub: "Chores", how: "learned" });
  });

  it("5. a cached Gemini answer is low confidence; the dictionary still beats it", () => {
    const cache = { [catKey("Blorp the frobnicator")]: { area: "work", sub: "Other" as const, at: 1 } };
    expect(area("Blorp the frobnicator", { cache })).toMatchObject({ area: "work", how: "gemini", conf: "low" });
    expect(area("gym", { cache: { gym: { area: "work", sub: "Other", at: 1 } } }).how).toBe("dictionary");
  });

  it("6. a guess stored on the item is replaced when a learned rule now disagrees, and kept when nothing else knows", () => {
    expect(categorise({ title: "gym", area: "finance", how: "dictionary" }, ctx({ rules }))).toMatchObject({ area: "walking", how: "learned" });
    expect(categorise({ title: "zxqv", area: "travel", how: "dictionary" }, ctx())).toMatchObject({ area: "travel", how: "dictionary" });
  });

  it("an area that is not one of yours is not used", () => {
    expect(categorise({ title: "laundry" }, { areas: new Set(["others", "home"]) })).toMatchObject({ area: "home", sub: "Chores" });
    expect(categorise({ title: "laundry" }, { areas: new Set(["others"]) })).toMatchObject({ area: "others", sub: "Chores" });
  });
});

// ---- the store, the history backfill and the Gemini fallback ---------------------------------------------------------------------------------

import { beforeEach, vi } from "vitest";

vi.mock("../lib/platform", () => ({ isNative: () => false }));

import { emptyData, migrate } from "../lib/backup";
import { lookupCategories, pendingLookups, resetCategoryLookups, runCategoryLookups } from "../lib/catAi";
import { annotateHistory } from "../lib/catHistory";
import { catCtx } from "../lib/categorise";
import { buildEntries } from "../lib/entries";
import { seedIfNeeded } from "../lib/seed";
import { actions, flushNow, getData } from "../lib/store";
import type { AppData, HistoryEvent } from "../lib/types";

const NOW = new Date(2026, 9, 12, 9, 0);
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });
const cap = (title: string) => ({ title, important: false, tags: [] as string[] });

describe("changing a category teaches the app", () => {
  beforeEach(() => {
    actions.replaceAll(base());
  });

  it("a new item with the same words lands in the learned category, and the rule beats the dictionary", async () => {
    const t = actions.addTask({ ...cap("Evening gym"), due: "2026-10-12" });
    expect(categorise({ title: t.title, area: t.area, how: t.catHow }, catCtx(getData())).area).toBe("health");
    // gym is Health by the dictionary; teach it: gym → Walking
    actions.setCategory({ key: `task:${t.id}`, title: t.title }, { area: "walking" });
    const fresh = actions.addTask({ ...cap("Gym with Sam"), due: "2026-10-13" });
    const c = categorise({ key: `task:${fresh.id}`, title: fresh.title, area: fresh.area, how: fresh.catHow }, catCtx(getData()));
    expect(c).toMatchObject({ area: "walking", how: "learned", conf: "high" });
    await flushNow();
    expect(getData().learned?.[0]).toMatchObject({ areaId: "walking" });
    expect(getData().tasks.find((x) => x.id === t.id)?.area).toBe("walking");
  });

  it("Other keeps its sub-label in the rule, and a rule can be deleted again", () => {
    const t = actions.addTask({ ...cap("sketch the logo"), due: "2026-10-12" });
    actions.setCategory({ key: `task:${t.id}`, title: t.title }, { area: "others", sub: "Building" });
    const next = categorise({ title: "logo sketch" }, catCtx(getData()));
    expect(next).toMatchObject({ area: "others", sub: "Building", how: "learned" });
    actions.forgetLearned(getData().learned![0].id);
    expect(categorise({ title: "logo sketch" }, catCtx(getData())).how).toBe("fallback");
  });
});

describe("the backfill of old history", () => {
  const ev = (key: string, title: string, extra: Partial<HistoryEvent> = {}): HistoryEvent => ({ id: key, at: 1, date: "2026-10-01", kind: "done", type: "task", key, title, createdByMe: true, ...extra });

  it("categorises entries without one, leaves the others, and a second run changes nothing", () => {
    const d = base();
    const list = [ev("task:1", "Gym"), ev("task:2", "pbi report"), ev("task:3", "mystery", { cat: { area: "work", sub: "Other", conf: "high" } })];
    const once = annotateHistory(list, d);
    expect(once.map((e) => e.cat?.area)).toEqual(["health", "powerbi", "work"]);
    expect(once[2]).toBe(list[2]);
    expect(annotateHistory(once, d)).toBe(once);
    expect(migrate({ ...d, version: 4, history: list }).history!.map((e) => e.cat?.area)).toEqual(["health", "powerbi", "work"]);
  });

  it("old history stays in the index after the item is gone", () => {
    const d = base({ history: [ev("task:gone", "Renew passport", { date: "2026-03-02", at: Date.UTC(2026, 2, 2), cat: { area: "others", sub: "Admin", conf: "medium" } })] });
    const e = buildEntries(d, "2026-10-12").find((x) => x.key === "task:gone");
    expect(e).toMatchObject({ kind: "history", date: "2026-03-02", status: "done", cat: { area: "others", sub: "Admin" } });
  });
});

describe("Gemini is only the last resort", () => {
  const d = base({ tasks: [{ id: "q", title: "Blorp the frobnicator", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, due: "2026-10-12" }] });
  beforeEach(() => resetCategoryLookups());

  it("finds only the titles nothing else can place, once each, skipping cached ones", () => {
    expect(pendingLookups(d, "2026-10-12")).toEqual(["Blorp the frobnicator"]);
    const cached = { ...d, catCache: { [catKey("Blorp the frobnicator")]: { area: "work", sub: "Other" as const, at: 1 } } };
    expect(pendingLookups(cached, "2026-10-12")).toEqual([]);
    expect(pendingLookups(base({ tasks: [{ ...d.tasks[0], title: "gym" }] }), "2026-10-12")).toEqual([]);
  });

  it("never calls the network offline, or without a key", async () => {
    const fetcher = vi.fn();
    expect(await lookupCategories(["Blorp"], d, { online: false, key: "k", fetcher })).toEqual({});
    expect(await lookupCategories(["Blorp"], d, { online: true, key: "", fetcher })).toEqual({});
    actions.replaceAll(d);
    expect(await runCategoryLookups({ online: false, key: "k", fetcher })).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getData().catCache).toBeUndefined();
  });

  it("online: sends only the title (not notes), caches the answer, and at most 20 per app open", async () => {
    const fetcher = vi.fn(async (_u: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ n: 1, area: "work", sub: "Other" }] }) }] } }] }), { status: 200 });
      void sent;
    });
    const withNotes = base({ tasks: [{ ...d.tasks[0], notes: "SECRET NOTE", due: "2026-10-12" }] });
    actions.replaceAll(withNotes);
    const got = await lookupCategories(["Blorp the frobnicator"], withNotes, { online: true, key: "k", model: "gemini-2.5-flash", fetcher: fetcher as never, timeoutMs: 4000 });
    expect(got[catKey("Blorp the frobnicator")]).toEqual({ area: "work", sub: "Other" });
    const body = String((fetcher.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("Blorp the frobnicator");
    expect(body).not.toContain("SECRET NOTE");
    // 25 unknown titles: one app open asks about 20 only.
    const many = base({ tasks: Array.from({ length: 25 }, (_, i) => ({ ...d.tasks[0], id: `t${i}`, title: `Zorp ${i}x${i}q` })) });
    expect(pendingLookups(many, "2026-10-12")).toHaveLength(20);
  });
});
