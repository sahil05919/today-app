import { describe, expect, it } from "vitest";
import { dictionarySize } from "../lib/dictionary";
import { seedIfNeeded } from "../lib/seed";
import { teachSuggestion } from "../lib/teach";
import { understand } from "../lib/understand";
import type { AppData } from "../lib/types";

/**
 * The offline dictionary, tested on everyday phrases in English, Hinglish and Devanagari.
 * Each base phrase is run through several wrappers (a date, "please", "remind me to", "kal"…) that must not change
 * where it lands. A phrase that becomes a calendar event with a time is accepted too (that's a different, correct answer).
 */
const NOW = new Date(2026, 9, 6, 9, 0);
const data: AppData = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, NOW);

const CASES: Record<string, string[]> = {
  work: [
    "send the weekly report", "reply to the client email", "prepare the sprint planning deck", "update jira ticket", "submit timesheet",
    "attend stand up", "review the pull request", "write meeting notes", "send status update to manager", "book a meeting room",
    "fix the production bug", "finish the presentation slides", "send invoice to client", "approve leave request", "prepare the project proposal",
    "follow up with the stakeholder", "share the release notes", "update the confluence page", "join the zoom call with the client", "schedule the one on one with my manager",
    "ऑफिस की रिपोर्ट भेजनी है", "meeting notes bhejna", "client ko update bhejna", "report banana hai", "office ka kaam khatam karna",
    "slack message reply karna", "deploy the hotfix", "raise a ticket for the vpn", "send agenda for the retro", "complete the okr review",
  ],
  powerbi: [
    "learn dax measures", "build the sales dashboard in power bi", "practice power query", "fix the pbix report", "study star schema data model",
    "power bi dashboard review", "create slicers for the report", "dax studio practice", "row level security in power bi", "DP-600 study",
    "pl-300 revision", "dax seekhna hai", "refresh the power bi dataset", "publish the power bi report", "पावर बीआई सीखना है",
  ],
  job: [
    "apply for jobs on linkedin", "update my resume", "write a cover letter", "mock interview practice", "leetcode two sum",
    "prepare for the hr round", "send thank you email to recruiter", "follow up with the recruiter", "apply to data analyst jobs", "check naukri alerts",
    "negotiate salary", "ask for a referral", "prepare for technical round", "sql interview questions", "resume bhejna hai",
    "naukri ke liye apply karna", "interview ki taiyari karni hai", "नौकरी के लिए अप्लाई करना है", "रिज्यूमे अपडेट करना", "job search karna hai",
    "update my portfolio for job applications",
  ],
  meditation: [
    "10 minutes of meditation", "pranayama in the morning", "guided meditation", "mindfulness practice", "anulom vilom", "ध्यान लगाना",
    "dhyaan karna hai", "breathing exercise",
  ],
  english: [
    "read a novel", "read the newspaper", "vocabulary practice", "grammar exercises", "ielts speaking practice", "listen to an english podcast",
    "write a short story", "kitab padhna hai", "spoken english practice", "listen to an audiobook",
  ],
  walking: ["evening walk", "go for a morning walk", "10k steps", "walk in the park", "hike this weekend", "टहलना है", "सैर पर जाना है", "tehalne jana hai"],
  health: [
    "go to the gym", "yoga class", "take vitamins", "refill prescription", "pick up medicine from the pharmacy", "blood test at the lab",
    "dentist checkup", "eye test at the optician", "get a haircut", "physio session", "book massage", "dawai leni hai",
    "doctor ko dikhana hai", "जिम जाना है", "योग करना है", "take medicine", "weigh myself", "go for a run", "swimming",
    "badminton practice", "skincare routine", "dermatologist appointment", "flu jab", "vaccination appointment", "therapy session",
    "counselling session", "hospital visit", "दवाई लेनी है",
  ],
  learning: [
    "study for the exam", "finish the udemy course", "coursera assignment", "revise chapter 4", "watch the tutorial", "complete the online course",
    "exam preparation", "mock test", "flashcards revision", "attend the webinar", "bootcamp homework", "padhai karni hai",
    "exam ki taiyari", "पढ़ाई करनी है", "कोर्स पूरा करना है", "learn python basics", "seekhna hai guitar",
  ],
  home: [
    "clean the bathroom", "do the laundry", "wash the dishes", "vacuum the living room", "mop the floor", "take out the bins",
    "cook dinner", "meal prep for the week", "water the plants", "iron clothes", "change the bedsheets", "call the plumber",
    "book an electrician", "fix the leaking tap", "clean the fridge", "declutter the wardrobe", "kitchen cleaning",
    "ghar ki safai karni hai", "jhadu pocha karna", "kapde dhona hai", "बर्तन धोना है", "खाना बनाना है", "pest control appointment",
  ],
  shopping: [
    "order a jacket on amazon", "return the parcel", "track my flipkart order", "buy new shoes", "buy a backpack", "order headphones online",
    "exchange the jeans", "collect the parcel", "check myntra sale", "buy a phone charger", "refund for the order", "order kurta online",
    "kharidari karni hai", "parcel wapas karna", "सामान मंगवाना है", "खरीदारी करनी है", "ajio order return karna", "buy laptop bag",
  ],
  finance: [
    "pay the electricity bill", "pay rent", "pay credit card bill", "transfer money to savings", "check bank balance", "renew insurance",
    "file income tax return", "check mutual fund sip", "review monthly budget", "pay emi", "recharge mobile", "cancel netflix subscription",
    "withdraw cash from the atm", "pay the council tax bill", "pay the broadband bill", "upi payment to landlord", "bill bharna hai", "emi bharna hai",
    "किराया देना है", "बिजली का बिल भरना है", "paise bhejna hai", "download payslip",
  ],
  family: [
    "call mum", "call papa on sunday", "ring my brother", "video call with nani", "plan didi's birthday", "send birthday wishes to dost",
    "meet up with friends", "catch up with an old friend", "visit the in-laws", "wish happy anniversary to mama", "maa ko phone karna hai",
    "bhai se milna hai", "दोस्त से मिलना है", "मम्मी को कॉल करना है", "call my cousin", "call grandma", "attend shaadi", "send flowers to mum",
    "check on dad", "whatsapp call with parents",
  ],
  travel: [
    "book flight tickets", "web check-in for the flight", "pack the suitcase", "apply for visa", "book a hotel in goa", "book train tickets on irctc",
    "plan the itinerary", "book an airbnb", "drop off at the airport", "get forex", "yatra ki taiyari",
    "ticket book karna hai", "टिकट बुक करना है", "होटल बुक करना है", "pack bags for the trip",
  ],
  admin: [
    "fill the visa form", "submit the application form", "renew driving licence", "book appointment at the council", "post the letter", "collect documents",
    "print the documents", "scan the documents", "register with the gp", "change of address", "sign the tenancy agreement", "notarise the affidavit",
    "apply for aadhaar", "renew passport", "form bharna hai", "documents jama karna", "print nikalna hai", "फॉर्म भरना है",
    "आधार अपडेट करना है", "पासपोर्ट रिन्यू करना है", "raise a complaint with the council", "xerox of id proof", "e-sign the contract",
  ],
  fun: [
    "watch a movie", "book cinema tickets", "go to the concert", "plan a picnic", "karaoke night", "go bowling", "visit the museum", "game night",
    "pub quiz", "comedy show", "picture dekhne jana hai", "film dekhni hai", "पार्टी में जाना है", "घूमने जाना है", "go clubbing",
  ],
  notes: [
    "idea: build a habit app", "someday learn piano", "maybe look into solar panels", "research standing desks", "bucket list: northern lights",
    "विचार: नया ऐप", "explore new hobbies",
  ],
};

const WRAPPERS: Array<(p: string) => string> = [
  (p) => p,
  (p) => `please ${p}`,
  (p) => `${p} tomorrow`,
  (p) => `${p} today`,
  (p) => `remind me to ${p}`,
  (p) => `${p} kal`,
  (p) => `${p} !`,
];

const all = Object.entries(CASES).flatMap(([area, list]) => list.flatMap((phrase) => WRAPPERS.map((wrap) => ({ area, phrase, text: wrap(phrase) }))));

describe("the offline dictionary", () => {
  it("knows hundreds of words and phrases across every area", () => {
    expect(dictionarySize()).toBeGreaterThanOrEqual(500);
  });

  it("is tested on 1000+ phrases", () => {
    expect(all.length).toBeGreaterThanOrEqual(1000);
  });

  it("puts each phrase in the right area, however it's worded", () => {
    const wrong: string[] = [];
    for (const c of all) {
      const p = understand(c.text, data, NOW);
      if (p.kind === "event") continue; // a timed commitment is a different (correct) answer
      const got = p.kind === "note" ? "notes" : p.area;
      if (got !== c.area) wrong.push(`${c.area} ← "${c.text}" (got ${got ?? "nothing"}, kind ${p.kind ?? "task"})`);
    }
    expect(wrong, wrong.slice(0, 40).join("\n")).toEqual([]);
  });

  it("a note: prefix files it under Ideas & Notes", () => {
    expect(understand("note: wifi password is on the router", data, NOW)).toMatchObject({ kind: "note", area: "notes" });
  });

  it("sends something it doesn't know to Others, so it can ask to learn it", () => {
    expect(understand("zorp the frobnicator", data, NOW).area).toBe("others");
  });
});

describe('teaching it a new word', () => {
  it('offers to learn what it does not know, and not what it does', () => {
    const unknown = understand('zorp the frobnicator', data, NOW);
    expect(teachSuggestion(unknown, data)?.words).toEqual(['frobnicator', 'zorp']);
    expect(teachSuggestion(understand('pay the electricity bill', data, NOW), data)).toBeNull();
    expect(teachSuggestion(understand('zorp the frobnicator @work', data, NOW), data)).toBeNull();
  });

  it('remembers the word offline, and from then on it files it there', () => {
    const taught: AppData = { ...data, userWords: [{ word: 'frobnicator', areaId: 'work', at: 1 }] };
    const p = understand('zorp the frobnicator', taught, NOW);
    expect(p.area).toBe('work');
    expect(teachSuggestion(p, taught)).toBeNull();
  });

  it('suggests the area Gemini found', () => {
    const ai = { ...understand('zorp the frobnicator', data, NOW), source: 'ai' as const, area: 'admin', areaSource: 'ai' as const };
    expect(teachSuggestion(ai, data)?.suggested).toBe('admin');
  });

  it('a typed @area is never overridden by a taught word', () => {
    const taught: AppData = { ...data, userWords: [{ word: 'frobnicator', areaId: 'work', at: 1 }] };
    expect(understand('zorp the frobnicator @family', taught, NOW).area).toBe('family');
  });
});
