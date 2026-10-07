import { describe, expect, it } from "vitest";
import { transcribeAudio } from "../lib/ai";

const reply = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } : { error: { message: "nope" } }), { status });

describe("voice: Gemini writes down what you said", () => {
  it("sends the recording as audio and returns the words, tidied", async () => {
    let body: { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: { responseSchema: { properties: Record<string, unknown> } } } | undefined;
    const r = await transcribeAudio(
      { base64: "UklGRg==", mime: "audio/wav" },
      {
        key: "TESTKEY",
        model: "gemini-2.5-flash",
        fetcher: async (_url, init) => {
          body = JSON.parse(String(init.body));
          return reply({ transcript: "  kal shaam 6 baje   mummy ko call karna hai " });
        },
      },
    );
    expect(r).toEqual({ ok: true, text: "kal shaam 6 baje mummy ko call karna hai" });
    const parts = body!.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "audio/wav", data: "UklGRg==" } });
    expect(String(parts[1].text)).toMatch(/Hinglish/);
    expect(Object.keys(body!.generationConfig.responseSchema.properties)).toEqual(["transcript"]);
  });

  it("silence comes back as an empty transcript, not an error", async () => {
    const r = await transcribeAudio({ base64: "AAAA", mime: "audio/wav" }, { key: "K", model: "m", fetcher: async () => reply({ transcript: "" }) });
    expect(r).toEqual({ ok: true, text: "" });
  });

  it("a failing call reports why, so the app can fall back to the phone's listener", async () => {
    const r = await transcribeAudio({ base64: "AAAA", mime: "audio/wav" }, { key: "K", model: "m", fetcher: async () => reply({}, 429) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rate-limit");
    const offline = await transcribeAudio(
      { base64: "AAAA", mime: "audio/wav" },
      {
        key: "K",
        model: "m",
        fetcher: async () => {
          throw new TypeError("Failed to fetch");
        },
      },
    );
    expect(offline.ok).toBe(false);
  });

  it("without a key it doesn't even try", async () => {
    const r = await transcribeAudio({ base64: "AAAA", mime: "audio/wav" }, { key: "" });
    expect(r.ok).toBe(false);
  });
});
