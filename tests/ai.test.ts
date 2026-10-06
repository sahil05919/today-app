import { describe, expect, it } from "vitest";
import { buildSystemPrompt, callGemini, fromAi, interpret, type AiIntent, type Fetcher } from "../lib/ai";
import { learnFix } from "../lib/learn";
import { seedIfNeeded } from "../lib/seed";
import { understand } from "../lib/understand";
import type { AppData } from "../lib/types";

// Tuesday 6 Oct 2026, 10:00.
const NOW = new Date(2026, 9, 6, 10, 0);
const T = "2026-10-06";
const data: AppData = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW);
const rulesFor = (text: string, d = data) => understand(text, d, NOW);

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
const ask = (text: string, ai: AiIntent, d = data) => interpret(text, rulesFor(text, d), d, NOW, { key: "k", model: "m", fetcher: fetcherOf(reply(ai)).fn });

describe("what Gemini is told", () => {
  const prompt = buildSystemPrompt(data, NOW);
  it("knows who you are, your areas and targets, and the date and time", () => {
    expect(prompt).toContain("Sahil");
    expect(prompt).toContain("Tuesday 2026-10-06, 10:00");
    expect(prompt).toContain("powerbi=Power BI [4x/week, 60 min]");
    expect(prompt).toContain("job=Job Prep & Apply [5x/week, 40 min, alternates Job Prep/Job Apply]");
    expect(prompt).toContain("others=Others");
  });
  it("knows your rhythm, work hours, check-ins and bills", () => {
    expect(prompt).toContain("Mon,Tue,Wed,Thu,Fri 09:00-17:00");
    expect(prompt).toContain("evening=Evening 18:00-20:15");
    expect(prompt).toContain("emails=Sort emails 20:00");
    expect(prompt).toContain("rent=Rent (cash) (Monthly, the 1st)");
    expect(prompt).toContain("mobile=Mobile bill (Monthly, the 1st, autopay)");
  });
  it("knows what's already planned today and tomorrow", () => {
    expect(prompt).toMatch(/Already planned today: .*Power BI session 1/);
    const withEvent = buildSystemPrompt({ ...data, events: [{ id: "e", title: "Dinner", date: "2026-10-07", start: "18:00", createdAt: 1 }] }, NOW);
    expect(withEvent).toContain("18:00 EVENT Dinner");
  });
  it("is sent with the key in a header (never the URL), a 5-second budget, and structured JSON", async () => {
    const f = fetcherOf(reply({ type: "task", title: "x", confidence: 0.9 }));
    await callGemini({ system: prompt, user: 'Note: "x"' }, { key: "SECRET", model: "m", fetcher: f.fn });
    expect(f.calls[0].url).not.toContain("SECRET");
    expect((f.calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET");
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.properties.type.enum).toContain("grocery");
    expect(body.systemInstruction.parts[0].text).toContain("Sahil");
  });
});

describe("Gemini understands what the rules can't", () => {
  it("a grocery item the dictionary has never heard of", async () => {
    expect(rulesFor("the pantry needs more cardamom").kind ?? "task").toBe("task"); // rules can't tell
    const r = await ask("the pantry needs more cardamom", { type: "grocery", title: "Cardamom", items: ["cardamom"], confidence: 0.92 });
    expect(r.used).toBe("ai");
    expect([r.parsed.kind, r.parsed.groceryItems]).toEqual(["grocery", ["Cardamom"]]);
  });

  it("a vague task is filed and slotted the way you'd want", async () => {
    const r = await ask("sort that thing with the landlord", { type: "task", title: "Sort the landlord thing", area: "admin", best_slot: "after-work", confidence: 0.8 });
    expect(r.parsed).toMatchObject({ kind: "task", area: "admin", due: T, dueTime: "17:15", source: "ai" });
  });

  it("an email-ish task gets the email hint and your email time", async () => {
    const r = await ask("deal with the thing in my starred folder", { type: "task", title: "Deal with starred folder", area: "work", best_slot: "emails", confidence: 0.8 });
    expect(r.parsed).toMatchObject({ area: "work", due: T, dueTime: "20:00" });
  });

  it("a fixed commitment becomes an event with its length", async () => {
    const r = await ask("catch up with Sam over coffee saturday afternoon 3", {
      type: "event",
      title: "Coffee with Sam",
      area: "family",
      date: "2026-10-10",
      time: "15:00",
      duration_min: 90,
      confidence: 0.9,
    });
    expect(r.parsed.kind).toBe("event");
    expect(r.parsed.due).toBe("2026-10-10");
    expect(r.parsed.event).toMatchObject({ start: "15:00" });
  });

  it("a note or idea stays out of your day", async () => {
    const r = await ask("what if I made a habit app for couples", { type: "idea", title: "Habit app for couples", confidence: 0.85 });
    expect(r.parsed).toMatchObject({ kind: "note", area: "notes" });
    expect(r.parsed.due).toBeUndefined();
  });

  it("reads priority, duration and repeats", async () => {
    const r = await ask("urgent: send the weekly report every friday, takes 45 min", {
      type: "task",
      title: "Send weekly report",
      area: "work",
      priority: "high",
      duration_min: 45,
      recurrence: "every friday",
      confidence: 0.9,
    });
    expect(r.parsed).toMatchObject({ important: true, estimateMin: 45, area: "work" });
    expect(r.parsed.recur?.freq).toBe("weekly");
  });

  it("an unpaid bill becomes a finance task; a paid one marks the bill paid", async () => {
    const todo = await ask("electricity bill due friday", { type: "bill", title: "Electricity bill", area: "finance", date: "2026-10-09", confidence: 0.9 });
    expect(todo.parsed).toMatchObject({ kind: "task", area: "finance", due: "2026-10-09" });
    const paid = await ask("sent the rent across this morning", { type: "bill", title: "Rent", done: true, confidence: 0.9 });
    expect(paid.parsed).toMatchObject({ kind: "paid", paidBillId: "rent" });
  });
});

describe("Gemini can't break anything", () => {
  it("never overrides a date or time you typed", async () => {
    const r = await ask("call mum tomorrow 6pm", { type: "reminder", title: "Call mum", area: "family", date: "2026-12-25", time: "09:00", confidence: 0.95 });
    expect(r.parsed).toMatchObject({ due: "2026-10-07", dueTime: "18:00", area: "family" });
  });

  it("never overrides an @area you typed", async () => {
    const r = await ask("ping Sam @fun", { type: "task", title: "Ping Sam", area: "work", confidence: 0.95 });
    expect(r.parsed.area).toBe("fun");
  });

  it("won't invent a finished session", async () => {
    // Nothing in the words says it was done, so a 'session' from Gemini is ignored.
    const r = await ask("power bi dashboards are fun", { type: "session", title: "Power BI", area: "powerbi", confidence: 0.9 });
    expect(r.parsed.kind).not.toBe("session");
    // But a real one is accepted.
    const real = await ask("just did my dax practice", { type: "session", title: "Power BI", area: "powerbi", confidence: 0.9 });
    expect(real.parsed).toMatchObject({ kind: "session", session: { areaId: "powerbi", date: T } });
  });

  it("rejects nonsense: bad dates, far dates, unknown areas, bad times, low confidence", () => {
    const rules = rulesFor("something vague");
    const run = (ai: AiIntent) => fromAi({ type: "task", title: "x", confidence: 0.9, ...ai }, rules, "something vague", data, NOW);
    // Bad dates are ignored: nothing is set, and the offline picker chooses a slot afterwards.
    expect(run({ date: "banana" })!.due).toBeUndefined();
    expect(run({ date: "2019-01-01" })!.due).toBeUndefined();
    expect(run({ date: "2031-01-01" })!.due).toBeUndefined();
    expect(run({ area: "nope" })!.area).toBe(rules.area);
    expect(run({ date: "2026-10-09", time: "25:99" })!.dueTime).toBeUndefined();
    expect(run({ confidence: 0.3 })).toBeNull();
    expect(fromAi({ type: "wizardry" as never, title: "x" }, rules, "x", data, NOW)).toBeNull();
  });

  it("a grocery answer with no items is ignored", async () => {
    const r = await ask("random thing", { type: "grocery", title: "x", items: [], confidence: 0.9 });
    expect(r.parsed.kind).not.toBe("grocery");
  });
});

describe("it learns from you, even over Gemini", () => {
  it("a remembered fix beats Gemini's guess", async () => {
    const learned = learnFix(undefined, "Starred email", { areaId: "finance", time: "07:45" });
    const d = { ...data, learned };
    const r = await ask("reply starred email", { type: "task", title: "Reply starred email", area: "work", confidence: 0.9 }, d);
    expect(r.parsed).toMatchObject({ area: "finance", dueTime: "07:45" });
  });
});

describe("when it can't help, the rules answer is used, silently", () => {
  const text = "mummy ko call";
  const rules = rulesFor(text);
  const run = (...rs: Array<Response | Error>) => interpret(text, rules, data, NOW, { key: "k", model: "m", fetcher: fetcherOf(...rs).fn });

  it("no key → rules, and no network at all", async () => {
    const f = fetcherOf(reply({}));
    const r = await interpret(text, rules, data, NOW, { key: "", fetcher: f.fn });
    expect([r.used, f.calls.length, r.parsed]).toEqual(["rules", 0, rules]);
  });
  it("offline", async () => {
    const r = await run(new TypeError("Failed to fetch"));
    expect([r.used, r.reason, r.parsed]).toEqual(["rules", "offline", rules]);
  });
  it("wrong key, free limit, server error, garbage", async () => {
    expect((await run(new Response("API key not valid", { status: 400 }))).reason).toBe("bad-key");
    expect((await run(new Response("denied", { status: 403 }))).reason).toBe("forbidden");
    expect((await run(new Response("", { status: 429 }))).reason).toBe("rate-limit");
    expect((await run(new Response("", { status: 500 }))).reason).toBe("failed");
    const junk = await run(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 }));
    expect([junk.used, junk.parsed]).toEqual(["rules", rules]);
  });
  it("too slow: gives up after the time budget and uses the rules", async () => {
    const slow: Fetcher = (_u, init) =>
      new Promise((_res, rej) => {
        (init.signal as AbortSignal).addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const t0 = Date.now();
    const r = await interpret(text, rules, data, NOW, { key: "k", model: "m", fetcher: slow, timeoutMs: 400 });
    expect(r.used).toBe("rules");
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
