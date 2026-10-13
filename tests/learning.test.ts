import { beforeEach, describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { areaNameOf, defaultPick, draftPost, learnAreas, learnPromptFor, learningsAsText, polishPost, postCard, unusedLearnings } from "../lib/learning";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import type { AppData, Learning, SessionLog } from "../lib/types";

const NOW = new Date(2026, 9, 14, 20, 0); // Wed 14 Oct 2026, 20:00
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });
let n = 0;
const log = (areaId: string, o: Partial<SessionLog> = {}): SessionLog => ({ id: `s${++n}`, areaId, date: "2026-10-14", minutes: 60, n, at: NOW.getTime() - 30_000, source: "manual", ...o });
const learning = (o: Partial<Learning> = {}): Learning => ({ id: `l${++n}`, date: "2026-10-14", areaId: "powerbi", text: `Learning ${n}`, at: NOW.getTime() - n * 1000, ...o });

describe("5. the learning prompt", () => {
  it("appears after a Power BI session (the default), and only for the chosen areas", () => {
    const d = base();
    expect(learnAreas(d)).toEqual(["powerbi"]);
    const pbi = log("powerbi");
    expect(learnPromptFor([], [pbi], d, NOW)).toBe(pbi);
    expect(learnPromptFor([], [log("walking")], d, NOW)).toBeNull();
    expect(learnPromptFor([], [log("job")], d, NOW)).toBeNull();
    // Add Job Prep in Settings and it asks too.
    const withJob = base({ profile: { ...d.profile!, learnAreas: ["powerbi", "job"] } });
    expect(learnPromptFor([], [log("job")], withJob, NOW)?.areaId).toBe("job");
    // Switch Power BI off and it does not.
    const none = base({ profile: { ...d.profile!, learnAreas: [] } });
    expect(learnPromptFor([], [log("powerbi")], none, NOW)).toBeNull();
  });

  it("only for a session that was JUST done: not on load, not for a restore, not for a backfilled day", () => {
    const d = base();
    const old = log("powerbi", { at: NOW.getTime() - 3_600_000 });
    const sessions = [old];
    expect(learnPromptFor(sessions, sessions, d, NOW)).toBeNull(); // nothing changed
    expect(learnPromptFor([], sessions, d, NOW)).toBeNull(); // an hour ago (a restored backup)
    expect(learnPromptFor([], [log("powerbi", { date: "2026-10-12" })], d, NOW)).toBeNull(); // another day
    expect(learnPromptFor([], [log("powerbi", { via: "backdated" })], d, NOW)).toBeNull();
    const fresh = log("powerbi");
    expect(learnPromptFor([old], [old, fresh], d, NOW)).toBe(fresh); // one new one among the old
  });
});

describe("5. the learning log", () => {
  beforeEach(() => actions.replaceAll(base()));

  it("saves, edits, deletes; empty lines are ignored", () => {
    const l = actions.addLearning("powerbi", "  CALCULATE changes   the filter context ", "2026-10-14", NOW)!;
    expect(getData().learnings).toEqual([expect.objectContaining({ id: l.id, areaId: "powerbi", text: "CALCULATE changes the filter context", date: "2026-10-14" })]);
    expect(actions.addLearning("powerbi", "   ")).toBeNull();
    actions.updateLearning(l.id, "CALCULATE changes the filter context, not the data");
    expect(getData().learnings![0].text).toMatch(/not the data$/);
    actions.removeLearning(l.id);
    expect(getData().learnings).toEqual([]);
  });

  it("Copy all / Share text: date, area, line", () => {
    const d = base({ learnings: [learning({ text: "Relationships go one way", date: "2026-10-13" }), learning({ text: "Measures beat columns", date: "2026-10-14" })] });
    const text = learningsAsText(d.learnings!, areaNameOf(d));
    expect(text).toContain("What I have been learning:");
    expect(text).toContain("- 13 Oct 2026 · Power BI: Relationships go one way");
    expect(text).toContain("- 14 Oct 2026 · Power BI: Measures beat columns");
  });
});

describe("5. the Sunday card and the post", () => {
  it("shows at 5 or more unused learnings, with the count; fewer shows nothing", () => {
    const some = (k: number) => base({ learnings: Array.from({ length: k }, () => learning()) });
    expect(postCard(some(4))).toBeNull();
    expect(postCard(some(5))).toMatchObject({ count: 5, pick: 3, text: "You have 5 learnings — turn 3 into a LinkedIn post?" });
    expect(postCard(some(8))!.text).toBe("You have 8 learnings — turn 3 into a LinkedIn post?");
  });

  it("used learnings drop out: after a post is shared they no longer count", () => {
    actions.replaceAll(base({ learnings: Array.from({ length: 8 }, () => learning()) }));
    const picked = defaultPick(getData());
    expect(picked).toHaveLength(3);
    actions.markLearningsUsed(picked.map((l) => l.id), NOW);
    expect(unusedLearnings(getData())).toHaveLength(5);
    expect(postCard(getData())!.count).toBe(5);
    expect(getData().learnings!.filter((l) => l.usedAt)).toHaveLength(3);
    // Four more used and the card goes away.
    actions.markLearningsUsed(defaultPick(getData(), 2).map((l) => l.id), NOW);
    expect(postCard(getData())).toBeNull();
  });

  it("the newest three are picked by default", () => {
    const list = Array.from({ length: 6 }, (_, i) => learning({ text: `L${i}`, at: NOW.getTime() - (6 - i) * 1000 }));
    expect(defaultPick(base({ learnings: list })).map((l) => l.text)).toEqual(["L5", "L4", "L3"]);
  });

  it("the offline draft: a first-person hook, bullets, a short close and at most two hashtags", () => {
    const d = base();
    const picked = [learning({ text: "calculate changes the filter context" }), learning({ text: "relationships only filter one way by default." }), learning({ text: "Measures beat calculated columns" })];
    const post = draftPost(picked, areaNameOf(d));
    const lines = post.split("\n");
    expect(lines[0]).toBe("Three things I learned about Power BI recently:");
    expect(post).toContain("• Calculate changes the filter context.");
    expect(post).toContain("• Relationships only filter one way by default.");
    expect(post).toContain("• Measures beat calculated columns.");
    expect(post).toMatch(/What is something new you picked up lately\?/);
    const tags = post.match(/#\w+/g)!;
    expect(tags).toEqual(["#PowerBI", "#Learning"]);
    expect(tags.length).toBeLessThanOrEqual(2);
    expect(post).not.toMatch(/\bwe\b/i);
  });

  it("one learning, and learnings from two areas", () => {
    const d = base();
    expect(draftPost([learning({ text: "x is y" })], areaNameOf(d)).split("\n")[0]).toBe("Something I learned about Power BI recently:");
    const two = draftPost([learning({ areaId: "powerbi", text: "a" }), learning({ areaId: "job", text: "b" })], areaNameOf(d));
    expect(two.split("\n")[0]).toBe("Two things I learned about Power BI and Job Prep & Apply recently:");
    expect(two.match(/#\w+/g)!.length).toBeLessThanOrEqual(2);
  });

  it("Polish with Gemini sends ONLY the chosen learnings, and stores nothing", async () => {
    const d = base({ learnings: [learning({ text: "chosen one" }), learning({ text: "another chosen" }), learning({ text: "NOT chosen secret" })] });
    const before = JSON.stringify(d);
    let sent = "";
    const fake = (async (req: { user: string; system?: string }) => {
      sent = req.user;
      return { ok: true, result: { post: "Polished post text" }, model: "m" };
    }) as unknown as Parameters<typeof polishPost>[2];
    const r = await polishPost(d.learnings!.slice(0, 2), areaNameOf(d), fake);
    expect(r).toEqual({ ok: true, text: "Polished post text" });
    expect(sent).toContain("chosen one");
    expect(sent).toContain("another chosen");
    expect(sent).not.toContain("secret");
    expect(JSON.stringify(d)).toBe(before);
    // A failure leaves the draft alone.
    const failing = (async () => ({ ok: false, reason: "offline", message: "Timed out" })) as unknown as Parameters<typeof polishPost>[2];
    expect(await polishPost(d.learnings!.slice(0, 1), areaNameOf(d), failing)).toEqual({ ok: false, reason: "Timed out" });
  });
});
