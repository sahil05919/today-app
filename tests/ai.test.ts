import { describe, expect, it } from "vitest";
import { buildPrompt, callGemini, mergeAi, needsAi, smartParse, type Fetcher } from "../lib/ai";
import { parseCapture } from "../lib/parse";
import { defaultProfile } from "../lib/profile";
import { seedIfNeeded } from "../lib/seed";

const NOW = new Date(2026, 9, 6, 10, 0); // Tue 6 Oct 2026
const TODAY = "2026-10-06";
const me = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }).profile!;
const areas = me.areas;

const reply = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status });
const fetcherOf = (...responses: Array<Response | Error>): { fn: Fetcher; calls: Array<{ url: string; init: RequestInit }> } => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  return {
    calls,
    fn: async (url, init) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
};

describe("when Gemini is asked", () => {
  it("not for notes the rules understood", () => {
    expect(needsAi(parseCapture("kal 6 baje gym jana hai", NOW, me), "kal 6 baje gym jana hai")).toBe(false);
  });
  it("yes when there's no date, or the area is unclear", () => {
    expect(needsAi(parseCapture("mummy ko call", NOW, me), "mummy ko call")).toBe(true);
    expect(needsAi(parseCapture("tuesday fix the thing", NOW, me), "tuesday fix the thing")).toBe(true); // area: others
  });
  it("never for the shopping list", () => {
    expect(needsAi(parseCapture("groceries: milk", NOW, me), "groceries: milk")).toBe(false);
  });
});

describe("asking Gemini", () => {
  it("sends the note, today's date and your areas, with the key in a header (not the URL)", async () => {
    const f = fetcherOf(reply({ title: "Call mum" }));
    await callGemini(buildPrompt("mummy ko call", areas, TODAY), { key: "SECRET", fetcher: f.fn });
    expect(f.calls[0].url).not.toContain("SECRET");
    expect((f.calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET");
    const prompt = JSON.parse(f.calls[0].init.body as string).contents[0].parts[0].text as string;
    expect(prompt).toContain("2026-10-06");
    expect(prompt).toContain("powerbi = Power BI");
    expect(prompt).toContain("mummy ko call");
  });

  it("fills a missing date and time", async () => {
    const f = fetcherOf(reply({ title: "Call mum", date: "2026-10-09", time: "18:30", areaId: "family" }));
    const rules = parseCapture("mummy ko call", NOW, me);
    const r = await smartParse("mummy ko call", rules, areas, TODAY, { key: "k", fetcher: f.fn });
    expect(r.used).toBe("ai");
    expect(r.parsed).toMatchObject({ due: "2026-10-09", dueTime: "18:30" });
  });

  it("never overrides a date the rules already found", () => {
    const rules = parseCapture("kal call mum", NOW, me);
    const merged = mergeAi(rules, { date: "2026-12-25", time: "09:00", areaId: "fun" }, areas, TODAY);
    expect(merged.due).toBe("2026-10-07");
    expect(merged.area).toBe(rules.area);
  });

  it("rejects nonsense: bad dates, far-away dates, unknown areas, bad times", () => {
    const rules = parseCapture("something vague", NOW, me);
    expect(mergeAi(rules, { date: "banana" }, areas, TODAY).due).toBeUndefined();
    expect(mergeAi(rules, { date: "2019-01-01" }, areas, TODAY).due).toBeUndefined();
    expect(mergeAi(rules, { date: "2031-01-01" }, areas, TODAY).due).toBeUndefined();
    expect(mergeAi(rules, { date: "2026-10-10", time: "25:99" }, areas, TODAY).dueTime).toBeUndefined();
    expect(mergeAi(rules, { areaId: "nope" }, areas, TODAY).area).toBe(rules.area);
  });

  it("can pick an area when the rules fell back to Others", () => {
    const rules = parseCapture("do the thing for the job", NOW, { ...me, areas: areas.filter((a) => a.id !== "job") });
    expect(rules.area).toBe("others");
    expect(mergeAi(rules, { areaId: "career" }, areas, TODAY).area).toBe("career");
  });

  it("keeps an event an event, and fills its time", () => {
    const rules = parseCapture("event friday dinner", NOW, me);
    expect(rules.kind).toBe("event");
    const merged = mergeAi({ ...rules, due: undefined }, { date: "2026-10-09", time: "19:00", endTime: "21:00" }, areas, TODAY);
    expect(merged.kind).toBe("event");
    expect(merged.event).toMatchObject({ start: "19:00", end: "21:00" });
  });
});

describe("when it can't help, the rules answer is used", () => {
  const rules = parseCapture("mummy ko call", NOW, me);
  const run = (...rs: Array<Response | Error>) => smartParse("mummy ko call", rules, areas, TODAY, { key: "k", fetcher: fetcherOf(...rs).fn });

  it("no key → rules, no network at all", async () => {
    const f = fetcherOf(reply({}));
    const r = await smartParse("mummy ko call", rules, areas, TODAY, { key: "", fetcher: f.fn });
    expect([r.used, f.calls.length]).toEqual(["rules", 0]);
  });
  it("offline", async () => {
    const r = await run(new TypeError("Failed to fetch"));
    expect([r.used, r.reason, r.parsed.title]).toEqual(["rules", "offline", rules.title]);
  });
  it("wrong key", async () => {
    expect((await run(new Response("API key not valid", { status: 400 }))).reason).toBe("bad-key");
    expect((await run(new Response("denied", { status: 403 }))).reason).toBe("bad-key");
  });
  it("free-tier limit", async () => {
    expect((await run(new Response("", { status: 429 }))).reason).toBe("rate-limit");
  });
  it("garbage from the model", async () => {
    const r = await run(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 }));
    expect(r.used).toBe("rules");
  });
  it("tries the next model if one has been retired", async () => {
    const f = fetcherOf(new Response("", { status: 404 }), reply({ title: "Call mum", date: "2026-10-08" }));
    const r = await smartParse("mummy ko call", rules, areas, TODAY, { key: "k", fetcher: f.fn });
    expect(r.used).toBe("ai");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].url).not.toBe(f.calls[0].url);
  });
});

describe("defaults", () => {
  it("a default profile still parses without any AI", () => {
    expect(parseCapture("kal call mum", NOW, defaultProfile()).due).toBe("2026-10-07");
  });
});
