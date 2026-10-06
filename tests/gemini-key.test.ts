import { describe, expect, it } from "vitest";
import { callGemini, cleanKey, explainFailure, listModels, rankFlashModels, testGeminiKey, type Fetcher } from "../lib/ai";

const modelList = (names: string[], methods = ["generateContent"]) =>
  new Response(JSON.stringify({ models: names.map((n) => ({ name: "models/" + n, supportedGenerationMethods: methods })) }), { status: 200 });
const googleError = (status: number, message: string, code = "INVALID_ARGUMENT") =>
  new Response(JSON.stringify({ error: { code: status, message, status: code } }), { status });
const GOOD = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: "reminder", title: "Call mummy", date: "2026-10-07", time: "18:00", confidence: 0.95 }) }] } }] }), { status: 200 });

/** Routes by URL: ListModels (GET .../models?key=) vs generateContent. Responses are factories so they can be reused. */
function urlFetcher(r: { list?: () => Response | Error; generate?: Array<() => Response | Error> }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let g = 0;
  const fn: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const gen = r.generate ?? [];
    const out = url.includes(":generateContent") ? gen[Math.min(g++, gen.length - 1)]() : r.list!();
    if (out instanceof Error) throw out;
    return out;
  };
  return { fn, calls };
}

describe("the saved key", () => {
  it("loses spaces, newlines and quote marks", () => {
    expect(cleanKey("  AIzaSyABC123\n")).toBe("AIzaSyABC123");
    expect(cleanKey('"AIza Sy\r\nABC"')).toBe("AIzaSyABC");
  });
  it("is sent clean even if it was pasted with a newline, and only in the header", async () => {
    const f = urlFetcher({ generate: [GOOD] });
    await callGemini({ user: "x" }, { key: "AIza123\n ", model: "m", fetcher: f.fn });
    expect((f.calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza123");
    expect(f.calls[0].url).not.toContain("AIza123");
  });
});

describe("ListModels", () => {
  it("is GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY", async () => {
    const f = urlFetcher({ list: () => modelList(["gemini-2.5-flash"]) });
    const r = await listModels(" KEY123\n", { fetcher: f.fn });
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(f.calls[0].url.startsWith("https://generativelanguage.googleapis.com/v1beta/models?")).toBe(true);
    expect(f.calls[0].url).toContain("key=KEY123");
    expect(f.calls[0].init.method).toBe("GET");
  });
  it("keeps the exact status and Google's message when it fails", async () => {
    const f = urlFetcher({ list: () => googleError(400, "API key not valid. Please pass a valid API key.") });
    expect(await listModels("bad", { fetcher: f.fn })).toMatchObject({
      ok: false,
      reason: "bad-key",
      status: 400,
      message: "API key not valid. Please pass a valid API key. (INVALID_ARGUMENT)",
    });
  });
});

describe("choosing a model from the list", () => {
  it("takes the newest stable Flash, whatever it's called, and skips things that aren't for text", () => {
    const ids = rankFlashModels(
      ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash-image", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro", "gemini-flash-latest", "text-embedding-004"].map(
        (name) => ({ name: "models/" + name, supportedGenerationMethods: ["generateContent"] }),
      ),
    );
    expect(ids).toEqual(["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-3-flash-preview"]);
    // A future model needs no code change.
    expect(rankFlashModels([{ name: "models/gemini-4-flash" }, { name: "models/gemini-3-flash" }])[0]).toBe("gemini-4-flash");
  });
  it("ignores models that can't generate text", () => {
    expect(rankFlashModels([{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["embedContent"] }])).toEqual([]);
  });
  it("is done automatically when no model is set", async () => {
    const f = urlFetcher({ list: () => modelList(["gemini-2.5-flash", "gemini-7-flash"]), generate: [GOOD] });
    const r = await callGemini({ user: "x" }, { key: "k", model: "", fetcher: f.fn });
    expect(r).toMatchObject({ ok: true, model: "gemini-7-flash" });
    expect(f.calls[1].url).toContain("/models/gemini-7-flash:generateContent");
  });
  it("a retired model: asks Google for the current list and tries again", async () => {
    const f = urlFetcher({ list: () => modelList(["gemini-9-flash"]), generate: [() => new Response("", { status: 404 }), GOOD] });
    const r = await callGemini({ user: "x" }, { key: "k", model: "", fetcher: f.fn });
    expect(r).toMatchObject({ ok: true, model: "gemini-9-flash" });
  });
});

describe("Test key", () => {
  it("shows the status, the chosen model and a sample read", async () => {
    const f = urlFetcher({ list: () => modelList(["gemini-2.5-flash"]), generate: [GOOD] });
    const r = await testGeminiKey("k", { fetcher: f.fn });
    expect(r.ok).toBe(true);
    expect(r.model).toBe("gemini-2.5-flash");
    expect(r.lines.join("\n")).toMatch(/ListModels: HTTP 200, 1 models[\s\S]*chosen automatically: gemini-2.5-flash[\s\S]*Call mummy/);
  });
  it("tries the next model when the first has no free quota", async () => {
    const f = urlFetcher({ list: () => modelList(["gemini-3-flash", "gemini-2.5-flash"]), generate: [() => googleError(429, "quota", "RESOURCE_EXHAUSTED"), GOOD] });
    expect((await testGeminiKey("k", { fetcher: f.fn })).model).toBe("gemini-2.5-flash");
  });
  it("shows the exact HTTP status and Google's message, then what it means", async () => {
    const r = await testGeminiKey("k", { fetcher: urlFetcher({ list: () => googleError(400, "API key not valid. Please pass a valid API key.") }).fn });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain("HTTP 400: API key not valid. Please pass a valid API key.");
    expect(r.lines[1]).toContain("API key is invalid");
  });
  it("a network error says so", async () => {
    const r = await testGeminiKey("k", { fetcher: urlFetcher({ list: () => new TypeError("Failed to fetch") }).fn });
    expect(r.lines.join("\n")).toMatch(/No response from Google: Failed to fetch[\s\S]*WebView/);
  });
  it("needs a key", async () => {
    expect((await testGeminiKey("  ")).ok).toBe(false);
  });
});

describe("errors in plain English", () => {
  it.each([
    [400, /invalid/i],
    [403, /restricted/i],
    [404, /model name/i],
    [429, /rate limit/i],
  ])("HTTP %i", async (status, words) => {
    const f = urlFetcher({ generate: [() => googleError(status, "boom")] });
    const r = await callGemini({ user: "x" }, { key: "k", model: "m", fetcher: f.fn });
    expect(r).toMatchObject({ ok: false, status });
    if (!r.ok) expect(explainFailure(r)).toMatch(words);
  });
  it("a network error points at the connection and WebView settings", () => {
    expect(explainFailure({ reason: "offline" })).toMatch(/internet[\s\S]*WebView/i);
  });
});
