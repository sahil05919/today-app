import { describe, expect, it } from "vitest";
import { normalizeHinglish } from "../lib/hinglish";
import { parseCapture } from "../lib/parse";

// Tuesday 6 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 6, 10, 0);

type Case = [phrase: string, expected: { title: string; due?: string; time?: string }];

const cases: Case[] = [
  // --- today / tomorrow / day after -------------------------------------
  ["kal doctor ko call karna hai", { title: "Doctor ko call", due: "2026-10-07" }],
  ["aaj dudh lana", { title: "Dudh lana", due: "2026-10-06" }],
  ["parso mummy ka birthday", { title: "Mummy ka birthday", due: "2026-10-08" }],
  ["kal tak bijli ka bill", { title: "Bijli ka bill", due: "2026-10-07" }],
  ["आज दूध लाना", { title: "दूध लाना", due: "2026-10-06" }],
  ["कल डॉक्टर को फोन करना है", { title: "डॉक्टर को फोन", due: "2026-10-07" }],
  ["परसों माँ का जन्मदिन", { title: "माँ का जन्मदिन", due: "2026-10-08" }],
  // --- weekdays ----------------------------------------------------------
  ["somvar ko gym", { title: "Gym", due: "2026-10-12" }],
  ["शनिवार को सफाई", { title: "सफाई", due: "2026-10-10" }],
  ["रविवार को माँ को फोन करना है", { title: "माँ को फोन", due: "2026-10-11" }],
  ["agle hafte somvar rent dena", { title: "Rent dena", due: "2026-10-12" }],
  ["shukravar tak report bhejna", { title: "Report bhejna", due: "2026-10-09" }],
  // --- week / month / weekend -------------------------------------------
  ["is hafte tak report submit karna hai", { title: "Report submit", due: "2026-10-11" }],
  ["mahine ke end tak tax bharna", { title: "Tax bharna", due: "2026-10-31" }],
  ["महीने के अंत तक किराया देना", { title: "किराया देना", due: "2026-10-31" }],
  ["weekend pe movie", { title: "Movie", due: "2026-10-10" }],
  ["वीकेंड पर पार्टी", { title: "पार्टी", due: "2026-10-10" }],
  ["3 din mein passport renew", { title: "Passport renew", due: "2026-10-09" }],
  ["15 tarikh ko rent", { title: "Rent", due: "2026-10-15" }],
  // --- clock times -------------------------------------------------------
  ["kal subah 7 baje dawai", { title: "Dawai", due: "2026-10-07", time: "07:00" }],
  ["कल सुबह 7 बजे दवाई", { title: "दवाई", due: "2026-10-07", time: "07:00" }],
  ["kal shaam 6 baje gym jana hai", { title: "Gym jana", due: "2026-10-07", time: "18:00" }],
  ["5 baje meeting", { title: "Meeting", due: "2026-10-06", time: "17:00" }],
  ["raat 9 baje dawai yaad dilana", { title: "Dawai", due: "2026-10-06", time: "21:00" }],
  ["saade 5 baje chai", { title: "Chai", due: "2026-10-06", time: "17:30" }],
  ["शनिवार शाम 5 बजे पार्टी", { title: "पार्टी", due: "2026-10-10", time: "17:00" }],
  ["कल ५ बजे मीटिंग", { title: "मीटिंग", due: "2026-10-07", time: "17:00" }],
  // 8am has already passed at 10:00, so it means tomorrow morning (chrono's forward-looking rule).
  ["8 baje walk", { title: "Walk", due: "2026-10-07", time: "08:00" }],
  // --- filler ------------------------------------------------------------
  ["yaad dilana: dentist ko call kal", { title: "Dentist ko call", due: "2026-10-07" }],
  ["mujhe kal passport lena hai", { title: "Passport lena", due: "2026-10-07" }],
  ["remind me to pay rent tomorrow", { title: "Pay rent", due: "2026-10-07" }],
  // --- no date understood: goes to Later --------------------------------
  ["kuch bhi karna hai", { title: "Kuch bhi" }],
  ["Buy milk", { title: "Buy milk" }],
  ["घर की सफाई", { title: "घर की सफाई" }],
  // --- plain English still works ----------------------------------------
  ["Call mum Sunday", { title: "Call mum", due: "2026-10-11" }],
  ["dentist tomorrow at 3pm", { title: "Dentist", due: "2026-10-07", time: "15:00" }],
  ["Finish report by end of this week", { title: "Finish report", due: "2026-10-11" }],
  ["clean flat this weekend", { title: "Clean flat", due: "2026-10-10" }],
];

describe("Hinglish + English capture parsing", () => {
  it("has at least 20 example phrases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)("%s", (phrase, expected) => {
    const p = parseCapture(phrase, NOW);
    expect(p.title).toBe(expected.title);
    expect(p.due).toBe(expected.due);
    expect(p.dueTime).toBe(expected.time);
  });
});

describe("normalizeHinglish", () => {
  it("translates to English", () => {
    expect(normalizeHinglish("kal shaam 6 baje")).toBe("tomorrow at 6pm");
    expect(normalizeHinglish("somvar ko")).toBe("monday");
    expect(normalizeHinglish("parso")).toBe("in 2 days");
  });
  it("leaves plain English untouched", () => {
    expect(normalizeHinglish("Buy milk on Friday")).toBe("Buy milk on Friday");
  });
  it("guesses am/pm for bare baje times", () => {
    expect(normalizeHinglish("4 baje")).toBe("at 4pm");
    expect(normalizeHinglish("9 baje")).toBe("at 9am");
    expect(normalizeHinglish("17 baje")).toBe("at 5pm");
  });
});

describe("tokens still work after Hinglish", () => {
  it("handles !, #tag and ~estimate together", () => {
    const p = parseCapture("kal report bhejna ! #work ~45m", NOW);
    expect(p).toMatchObject({ title: "Report bhejna", due: "2026-10-07", important: true, tags: ["work"], estimateMin: 45 });
  });
  it("keeps links out of the date parser", () => {
    const p = parseCapture("Read https://example.com/2026/12/25 later", NOW);
    expect(p.due).toBeUndefined();
    expect(p.notes).toBe("https://example.com/2026/12/25");
    expect(p.title).toBe("Read later");
  });
});
