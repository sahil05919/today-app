import { describe, expect, it } from "vitest";
import { findDate, findTimes, looksLikeBooking, parseShared } from "../lib/shareParse";
import { readWithGemini } from "../lib/shareAi";

const NOW = new Date(2026, 9, 12, 20, 0);
const PINNACLE = "Pinnacle Event Staff … Approved … Tue, 3 Nov 2026 (07:00-10:00 GMT) · PE898 World Traveller Market Exhibition, Standby";

describe("6. email → event: read on the phone", () => {
  it("handles the real Pinnacle example exactly", () => {
    expect(parseShared(PINNACLE, NOW)).toEqual({
      title: "WTM Exhibition shift (Pinnacle) — Standby",
      date: "2026-11-03",
      start: "07:00",
      end: "10:00",
      status: "Approved",
      area: "sidework",
      source: "local",
      shift: true,
    });
  });

  it("copes with the three dots Gmail may use, a subject line on top, and extra email around it", () => {
    const body = `Subject: Shift confirmation\n\nHi Sahil,\n\n${PINNACLE.replaceAll("…", "...")}\n\nPlease arrive 15 minutes early.\nThanks, the team`;
    const p = parseShared(body, NOW)!;
    expect(p).toMatchObject({ date: "2026-11-03", start: "07:00", end: "10:00", status: "Approved" });
    expect(p.title).toContain("WTM Exhibition shift");
  });

  it("reads other date and time styles", () => {
    expect(findDate("Meet on 3rd November 2026 at the venue", NOW)?.date).toBe("2026-11-03");
    expect(findDate("Nov 3, 2026", NOW)?.date).toBe("2026-11-03");
    expect(findDate("03/11/2026", NOW)?.date).toBe("2026-11-03"); // UK order
    expect(findDate("on Fri, 20 Nov", NOW)?.date).toBe("2026-11-20"); // next one that comes round
    expect(findDate("on 5 Oct", NOW)?.date).toBe("2027-10-05"); // already gone this year
    expect(findDate("see you soon", NOW)).toBeNull();
    expect(findTimes("(7am-10am)", "2026-11-03")).toMatchObject({ start: "07:00", end: "10:00" });
    expect(findTimes("from 18:30 to 21:00", "2026-11-03")).toMatchObject({ start: "18:30", end: "21:00" });
    expect(findTimes("at 7pm", "2026-11-03")).toMatchObject({ start: "19:00" });
    // A date is not a time.
    expect(findTimes("3 Nov 2026", "2026-11-03")).toBeNull();
  });

  it("a time given in GMT in summer is London's BST: an hour later on the clock", () => {
    // 14 Jul 2026 is in British Summer Time: 07:00 GMT is 08:00 in London.
    expect(findTimes("(07:00-10:00 GMT)", "2026-07-14")).toMatchObject({ start: "08:00", end: "11:00" });
    expect(findTimes("(07:00-10:00 BST)", "2026-07-14")).toMatchObject({ start: "07:00", end: "10:00" });
    expect(findTimes("(07:00-10:00 GMT)", "2026-11-03")).toMatchObject({ start: "07:00", end: "10:00" });
  });

  it("an ordinary booking is an event too, without the shift wording", () => {
    const p = parseShared("Your appointment at Smile Dental is confirmed for Mon, 9 Nov 2026 at 14:30 – 15:00 · Check-up", NOW)!;
    expect(p).toMatchObject({ date: "2026-11-09", start: "14:30", end: "15:00", status: "Confirmed", shift: false });
    expect(p.area).toBeUndefined();
    expect(p.title).toBe("Check-up");
  });

  it("a date without a time is still an event (the sheet asks for the time)", () => {
    const p = parseShared("Reminder: carnival volunteers meeting on 21 Nov 2026 in the town hall", NOW)!;
    expect(p.date).toBe("2026-11-21");
    expect(p.start).toBeUndefined();
  });

  it("no date: it is not read (so Gemini may be asked, if a key is set)", () => {
    expect(parseShared("Can you send me the report when you get a chance?", NOW)).toBeNull();
    expect(parseShared("", NOW)).toBeNull();
    expect(looksLikeBooking("Can you send me the report when you get a chance? Thanks, it is 5 pages long really")).toBe(true);
    expect(looksLikeBooking("https://example.com/page")).toBe(false);
    expect(looksLikeBooking("buy milk")).toBe(false);
  });
});

describe("6. the Gemini fallback (only when the phone found no date)", () => {
  const reply = (obj: unknown) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });

  it("reads a booking the phone could not, labelled as Gemini's", async () => {
    const r = await readWithGemini("Hi Sahil, your interview with ACME is next Tuesday the tenth of November at two in the afternoon, finishing at three.", NOW, {
      fetcher: reply({ isEvent: true, title: "Interview with ACME", date: "2026-11-10", start: "14:00", end: "15:00", status: "Confirmed" }),
      key: "abc",
      model: "gemini-2.5-flash",
    });
    expect(r).toMatchObject({ source: "gemini", title: "Interview with ACME", date: "2026-11-10", start: "14:00", end: "15:00", status: "Confirmed", shift: false });
  });

  it("sends ONLY the shared text (plus today's date), nothing from the app", async () => {
    let body = "";
    await readWithGemini("Your dentist visit is booked for the second Monday of November at half past two.", NOW, {
      fetcher: async (_u, init) => ((body = String(init.body)), new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ isEvent: false }) }] } }] }), { status: 200 })),
      key: "abc",
      model: "gemini-2.5-flash",
    });
    expect(body).toContain("dentist visit");
    expect(body).not.toMatch(/tasks|profile|sessions|powerbi|areas/i);
  });

  it("says nothing when it is not a booking, when the date is invalid, when there is no key, or when Google fails", async () => {
    const opts = { key: "abc", model: "gemini-2.5-flash" };
    expect(await readWithGemini("x".repeat(80), NOW, { ...opts, fetcher: reply({ isEvent: false }) })).toBeNull();
    expect(await readWithGemini("x".repeat(80), NOW, { ...opts, fetcher: reply({ isEvent: true, date: "next week" }) })).toBeNull();
    expect(await readWithGemini("x".repeat(80), NOW, { ...opts, key: "", fetcher: reply({ isEvent: true, date: "2026-11-10" }) })).toBeNull();
    expect(await readWithGemini("x".repeat(80), NOW, { ...opts, fetcher: async () => new Response("no", { status: 500 }) })).toBeNull();
  });
});
