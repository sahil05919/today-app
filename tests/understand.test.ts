import { describe, expect, it } from "vitest";
import { applyLearned, learnFix, matchLearned, significantWords } from "../lib/learn";
import { seedIfNeeded } from "../lib/seed";
import { suggestSlot } from "../lib/slots";
import { understand } from "../lib/understand";
import type { AppData } from "../lib/types";

// Tuesday 6 Oct 2026, 10:00: a work day, before the evening. Everything below is relative to that.
const NOW = new Date(2026, 9, 6, 10, 0);
const data: AppData = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, NOW);
const u = (text: string, d: AppData = data, now = NOW) => understand(text, d, now);

interface Exp {
  kind?: "task" | "event" | "grocery" | "session" | "paid" | "note";
  area?: string;
  due?: string;
  time?: string;
  /** exact due-less result (stays in Later) */
  noDue?: true;
  items?: string[];
  session?: { areaId: string; date: string };
  paid?: string;
  recur?: string;
  start?: string;
  allDay?: true;
  countsFor?: string;
  reason?: string;
}

function check(phrase: string, e: Exp) {
  const p = u(phrase);
  expect(p.kind ?? "task", `kind of “${phrase}”`).toBe(e.kind ?? "task");
  if (e.area) expect(p.area, `area of “${phrase}”`).toBe(e.area);
  if (e.due) expect(p.due, `date of “${phrase}”`).toBe(e.due);
  if (e.time) expect(p.dueTime, `time of “${phrase}”`).toBe(e.time);
  if (e.noDue) expect(p.due, `“${phrase}” stays undated`).toBeUndefined();
  if (e.items) expect(p.groceryItems, `items of “${phrase}”`).toEqual(e.items);
  if (e.session) expect(p.session, `session of “${phrase}”`).toEqual(e.session);
  if (e.paid) expect(p.paidBillId, `bill of “${phrase}”`).toBe(e.paid);
  if (e.recur) expect(p.recur?.freq, `repeat of “${phrase}”`).toBe(e.recur);
  if (e.start) expect(p.event?.start, `start of “${phrase}”`).toBe(e.start);
  if (e.allDay) expect(p.event?.start, `“${phrase}” is all day`).toBeUndefined();
  if (e.countsFor) expect(p.event?.countsFor, `countsFor of “${phrase}”`).toBe(e.countsFor);
  if (e.reason) expect(p.slotReason, `slot reason of “${phrase}”`).toBe(e.reason);
}

const T = "2026-10-06";
const TOMORROW = "2026-10-07";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const YESTERDAY = "2026-10-05";

// ---------------------------------------------------------------------------------------------------
const sessions: Array<[string, Exp]> = [
  ["did Power BI", { kind: "session", session: { areaId: "powerbi", date: T } }],
  ["did power bi for an hour", { kind: "session", session: { areaId: "powerbi", date: T } }],
  ["Power BI done", { kind: "session", session: { areaId: "powerbi", date: T } }],
  ["finished my dax practice", { kind: "session", session: { areaId: "powerbi", date: T } }],
  ["meditation kiya", { kind: "session", session: { areaId: "meditation", date: T } }],
  ["aaj meditation kiya", { kind: "session", session: { areaId: "meditation", date: T } }],
  ["kal meditation kiya", { kind: "session", session: { areaId: "meditation", date: YESTERDAY } }],
  ["मेडिटेशन किया", { kind: "session", session: { areaId: "meditation", date: T } }],
  ["walk kar li", { kind: "session", session: { areaId: "walking", date: T } }],
  ["walk ho gayi", { kind: "session", session: { areaId: "walking", date: T } }],
  ["finished my walk", { kind: "session", session: { areaId: "walking", date: T } }],
  ["had a walk this evening", { kind: "session", session: { areaId: "walking", date: T } }],
  ["completed english reading", { kind: "session", session: { areaId: "english", date: T } }],
  ["reading done", { kind: "session", session: { areaId: "english", date: T } }],
  ["job apply kar liya", { kind: "session", session: { areaId: "job", date: T } }],
  ["finished job prep", { kind: "session", session: { areaId: "job", date: T } }],
  ["yesterday I did power bi", { kind: "session", session: { areaId: "powerbi", date: YESTERDAY } }],
  // not a session: negated, or about the future
  ["didn't do power bi", { kind: "task", area: "powerbi" }],
  ["power bi tomorrow", { kind: "task", area: "powerbi", due: TOMORROW }],
  ["need to do meditation tonight", { kind: "task", area: "meditation" }],
  ["will finish the power bi report friday", { kind: "task", area: "powerbi", due: FRI }],
];

const groceries: Array<[string, Exp]> = [
  ["milk khatam", { kind: "grocery", items: ["Milk"] }],
  ["need sugar", { kind: "grocery", items: ["Sugar"] }],
  ["out of eggs", { kind: "grocery", items: ["Eggs"] }],
  ["we're out of rice", { kind: "grocery", items: ["Rice"] }],
  ["running low on oil", { kind: "grocery", items: ["Oil"] }],
  ["doodh khatam ho gaya", { kind: "grocery", items: ["Doodh"] }],
  ["atta khatam ho gaya hai", { kind: "grocery", items: ["Atta"] }],
  ["chini khatam", { kind: "grocery", items: ["Chini"] }],
  ["chai patti khatam", { kind: "grocery", items: ["Chai patti"] }],
  ["दूध खत्म", { kind: "grocery", items: ["दूध"] }],
  ["ghar mein dahi nahi hai", { kind: "grocery", items: ["Dahi"] }],
  ["buy milk", { kind: "grocery", items: ["Milk"] }],
  ["buy milk and bread", { kind: "grocery", items: ["Milk", "Bread"] }],
  ["buy milk tomorrow", { kind: "grocery", items: ["Milk"] }],
  ["get eggs", { kind: "grocery", items: ["Eggs"] }],
  ["pick up vegetables", { kind: "grocery", items: ["Vegetables"] }],
  ["add paneer to my shopping list", { kind: "grocery", items: ["Paneer"] }],
  ["sugar chahiye", { kind: "grocery", items: ["Sugar"] }],
  ["doodh lana hai", { kind: "grocery", items: ["Doodh"] }],
  ["tamatar aur pyaaz lena hai", { kind: "grocery", items: ["Tamatar", "Pyaaz"] }],
  ["milk, bread, eggs", { kind: "grocery", items: ["Milk", "Bread", "Eggs"] }],
  ["need 2 litres of milk", { kind: "grocery", items: ["2 litres milk"] }],
  ["groceries: milk, sugar", { kind: "grocery", items: ["Milk", "Sugar"] }],
  ["shopping list: toothpaste and shampoo", { kind: "grocery", items: ["Toothpaste", "Shampoo"] }],
  ["milk", { kind: "grocery", items: ["Milk"] }],
  // not groceries
  ["buy shoes", { kind: "task", area: "shopping" }],
  ["order amazon parcel", { kind: "task", area: "shopping" }],
  ["need to call mum", { kind: "task", area: "family" }],
  ["kaam khatam", { kind: "task" }],
];

const bills: Array<[string, Exp]> = [
  ["paid rent", { kind: "paid", paid: "rent" }],
  ["rent bhar diya", { kind: "paid", paid: "rent" }],
  ["kiraya de diya", { kind: "paid", paid: "rent" }],
  ["credit card bill paid", { kind: "paid", paid: "credit-card" }],
  ["paid the credit card", { kind: "paid", paid: "credit-card" }],
  ["mobile bill paid", { kind: "paid", paid: "mobile" }],
  // still to do
  ["pay rent", { kind: "task", area: "finance" }],
  ["I will pay rent tomorrow", { kind: "task", area: "finance", due: TOMORROW }],
  ["pay electricity bill friday", { kind: "task", area: "finance", due: FRI }],
  ["pay credit card bill on 15th", { kind: "task", area: "finance", due: "2026-10-15" }],
  ["withdraw cash for rent", { kind: "task", area: "finance", reason: "after work" }],
  ["bank statement", { kind: "task", area: "finance" }],
];

const events: Array<[string, Exp]> = [
  ["event Wednesday 6pm dinner", { kind: "event", due: TOMORROW, start: "18:00" }],
  ["event saturday outing at the park", { kind: "event", due: SAT, allDay: true, countsFor: "walking" }],
  ["event friday 7pm movie", { kind: "event", due: FRI, start: "19:00" }],
  ["event sunday brunch with family", { kind: "event", due: SUN, allDay: true }],
  ["event shanivar shaam 6 baje dinner", { kind: "event", due: SAT, start: "18:00" }],
  ["event 15 oct dentist 3pm", { kind: "event", due: "2026-10-15", start: "15:00" }],
  // implied events: a commitment with a clock time
  ["dinner with Priya Saturday 7pm", { kind: "event", due: SAT, start: "19:00" }],
  ["movie friday 8pm", { kind: "event", due: FRI, start: "20:00" }],
  ["dentist appointment tomorrow 3pm", { kind: "event", due: TOMORROW, start: "15:00" }],
  ["meeting with client tomorrow 2pm", { kind: "event", due: TOMORROW, start: "14:00" }],
  ["flight to Delhi on 20 Oct 6am", { kind: "event", due: "2026-10-20", start: "06:00" }],
  ["party saturday 9pm", { kind: "event", due: SAT, start: "21:00" }],
  ["birthday party sunday 4pm", { kind: "event", due: SUN, start: "16:00" }],
  ["concert saturday 7:30pm", { kind: "event", due: SAT, start: "19:30" }],
  ["interview thursday 11am", { kind: "event", due: "2026-10-08", start: "11:00" }],
  ["yoga class saturday 9am", { kind: "event", due: SAT, start: "09:00" }],
  ["shaam 7 baje doston ke saath dinner kal", { kind: "event", due: TOMORROW, start: "19:00" }],
  // tasks about events, not events
  ["call dentist tomorrow 3pm", { kind: "task", area: "health", due: TOMORROW, time: "15:00" }],
  ["book dentist tomorrow", { kind: "task", area: "health", due: TOMORROW }],
  ["book restaurant for saturday dinner", { kind: "task" }],
  ["prepare for the interview thursday", { kind: "task", area: "job", due: "2026-10-08" }],
];

const vague: Array<[string, Exp]> = [
  // emails belong at your email time (20:00)
  ["reply starred email", { area: "work", due: T, time: "20:00", reason: "email time" }],
  ["reply to client email", { area: "work", due: T, time: "20:00", reason: "email time" }],
  ["check inbox", { area: "work", due: T, time: "20:00", reason: "email time" }],
  ["gmail cleanup", { due: T, time: "20:00", reason: "email time" }],
  ["mail ka reply dena hai", { due: T, time: "20:00", reason: "email time" }],
  // work during work hours
  ["send invoice to client", { area: "work", due: T, time: "10:30", reason: "work hours" }],
  ["update the project plan", { area: "work", due: T, reason: "work hours" }],
  ["kaam: follow up with manager", { area: "work", due: T }],
  // after work
  ["renew passport", { area: "admin", due: T, time: "17:15", reason: "after work" }],
  ["council tax letter", { area: "admin", due: T, time: "17:15" }],
  ["GP appointment", { area: "admin", due: T }],
  ["fill the tenancy form", { area: "admin", due: T }],
  ["transfer money to savings", { area: "finance", due: T, time: "17:15" }],
  // evenings
  ["papa ko call karna hai", { area: "family", due: T, time: "17:30", reason: "evening" }],
  ["call mum", { area: "family", due: T, time: "17:30" }],
  ["birthday gift for mum", { area: "family", due: T }],
  ["clean room", { area: "home", due: T, time: "17:30" }],
  ["laundry", { area: "home", due: T }],
  ["cook dinner", { area: "home" }],
  ["ghar ki safai", { area: "home" }],
  ["kapde dhona hai", { area: "home" }],
  ["tidy desk", { area: "home" }],
  ["water the plants", { area: "home" }],
  ["fix the tap", { area: "home" }],
  ["call the plumber", { area: "home" }],
  ["take vitamins", { area: "health", due: T }],
  ["dawai leni hai", { area: "health" }],
  ["go to the gym", { area: "health" }],
  ["doctor ko call karna hai", { area: "health" }],
  ["study for the exam", { area: "learning", due: T, time: "20:30", reason: "evening study time" }],
  ["udemy course", { area: "learning", time: "20:30" }],
  // weekend things wait for the weekend
  ["book flight tickets for Diwali", { area: "travel", due: SAT, time: "11:00", reason: "weekend" }],
  ["plan weekend trip", { area: "travel", due: SAT }],
  ["hotel booking for Goa", { area: "travel", due: SAT }],
  ["pack for the trip", { area: "travel", due: SAT }],
  ["book train tickets", { area: "travel" }],
  ["movie night with friends saturday", { area: "fun", due: SAT }],
  ["return the parcel", { area: "shopping", due: SAT }],
  // your weekly practice areas slot into their next planned session
  ["practice DAX", { area: "powerbi", due: T }],
  ["watch power bi tutorial", { area: "powerbi" }],
  ["apply to 3 jobs", { area: "job" }],
  ["update CV", { area: "job" }],
  ["linkedin post", { area: "job" }],
  ["evening walk", { area: "walking" }],
  ["meditate", { area: "meditation" }],
  ["read the news article", { area: "english" }],
  ["vocabulary revision", { area: "english" }],
  // nothing matches: Others, in the evening, never lost in Later
  ["sort out the thing", { area: "others", due: T, time: "17:30" }],
  ["figure out the thing", { area: "others", due: T }],
];

const dated: Array<[string, Exp]> = [
  ["call mum tomorrow", { area: "family", due: TOMORROW }],
  ["mummy ko call kal shaam 6 baje", { area: "family", due: TOMORROW, time: "18:00" }],
  ["remind me to call mum at 6pm", { area: "family", due: T, time: "18:00" }],
  ["prepare presentation for Monday", { area: "work", due: "2026-10-12" }],
  ["submit timesheet friday", { area: "work", due: FRI }],
  ["call grandma sunday", { area: "family", due: SUN }],
  ["gym 6am tomorrow", { area: "health", due: TOMORROW, time: "06:00" }],
  ["morning meditation 7am", { area: "meditation", due: TOMORROW, time: "07:00" }],
  ["take out the trash tonight", { area: "home", due: T }],
  ["परसों माँ का जन्मदिन", { area: "family", due: "2026-10-08" }],
  ["शनिवार को सफाई", { area: "home", due: SAT }],
  ["agle hafte somvar rent dena", { area: "finance", due: "2026-10-12" }],
  ["is hafte tak report submit karna hai", { area: "work", due: SUN }],
  ["mahine ke end tak tax bharna", { area: "finance", due: "2026-10-31" }],
  ["weekend pe movie", { area: "fun", due: SAT }],
  ["3 din mein passport renew", { area: "admin", due: "2026-10-09" }],
];

const repeating: Array<[string, Exp]> = [
  ["every monday power bi", { area: "powerbi", recur: "weekly", due: "2026-10-12" }],
  ["har somvar gym", { area: "health", recur: "weekly", due: "2026-10-12" }],
  ["daily meditation", { area: "meditation", recur: "daily", due: T }],
  ["roz subah walk", { area: "walking", recur: "daily", due: T }],
  ["every 1st pay rent", { area: "finance", recur: "monthly", due: "2026-11-01" }],
  ["weekdays check inbox", { area: "work", recur: "weekly", due: T }],
  ["every sunday call family", { area: "family", recur: "weekly", due: SUN }],
  ["weekly review", { recur: "weekly", due: T }],
  ["har mahine ki 5 tarikh rent", { area: "finance", recur: "monthly", due: "2026-11-05" }],
  ["हर सोमवार जिम", { area: "health", recur: "weekly", due: "2026-10-12" }],
];

const notes: Array<[string, Exp]> = [
  ["idea: build a budget tracker app", { kind: "note", area: "notes", noDue: true }],
  ["note: wifi password changed", { kind: "note", area: "notes", noDue: true }],
  ["remember: renew insurance in March", { kind: "note", area: "notes", noDue: true }],
  ["someday learn guitar", { area: "notes", noDue: true }],
  ["thought: maybe a weekend course", { kind: "note", area: "notes", noDue: true }],
];

describe("understanding what you type, English and Hinglish", () => {
  const tables: Array<[string, Array<[string, Exp]>]> = [
    ["finishing a session", sessions],
    ["groceries", groceries],
    ["bills", bills],
    ["fixed events", events],
    ["vague tasks get a sensible slot", vague],
    ["tasks with a date", dated],
    ["repeating things", repeating],
    ["notes and ideas", notes],
  ];

  it("has well over 100 realistic phrases", () => {
    expect(tables.reduce((n, [, rows]) => n + rows.length, 0)).toBeGreaterThanOrEqual(130);
  });

  for (const [name, rows] of tables) {
    describe(name, () => {
      it.each(rows)("%s", (phrase, exp) => check(phrase, exp));
    });
  }
});

describe("slots follow the clock", () => {
  const at = (h: number, m = 0, day = 6) => new Date(2026, 9, day, h, m);
  it("an email at 21:30 waits for tomorrow's email time", () => {
    expect(suggestSlot("work", "reply to email", data, at(21, 30))).toMatchObject({ date: TOMORROW, time: "20:00" });
  });
  it("work tasks in the afternoon still land inside work hours", () => {
    expect(suggestSlot("work", "send report", data, at(15, 10))).toMatchObject({ date: T, time: "16:00" });
  });
  it("work tasks after hours wait for the next work morning", () => {
    expect(suggestSlot("work", "send report", data, at(18, 0))).toMatchObject({ date: TOMORROW, time: "10:00" });
  });
  it("weekend things on a Saturday go to that day", () => {
    expect(suggestSlot("travel", "plan trip", data, at(9, 0, 10))).toMatchObject({ date: SAT, time: "11:00" });
  });
  it("on a weekend, admin doesn't wait for 'after work'", () => {
    expect(suggestSlot("admin", "call council", data, at(9, 0, 10))).toMatchObject({ time: "11:00" });
  });
});

describe("learning from your fixes", () => {
  it("keeps the meaningful words of a title", () => {
    expect(significantWords("Reply to the starred emails please")).toEqual(["reply", "starred", "emails"]);
  });

  it("an area fix applies next time, even to a similar title", () => {
    const rules = learnFix(undefined, "Starred email", { areaId: "finance" });
    const p = applyLearned({ ...u("check starred emails"), area: "work", areaSource: "guess" }, rules);
    expect(p.area).toBe("finance");
    expect(p.areaSource).toBe("learned");
  });

  it("a time fix applies too, and a typed time still wins", () => {
    const rules = learnFix(undefined, "Water the plants", { time: "07:30" });
    const learned = applyLearned(u("water the plants"), rules);
    expect(learned.dueTime).toBe("07:30");
    expect(applyLearned(u("water the plants tomorrow 9am"), rules).dueTime).toBe("09:00");
  });

  it("a fix also catches similar wording, but not a different thing", () => {
    const rules = learnFix(undefined, "Reply starred email", { areaId: "finance" });
    expect(matchLearned(rules, "check starred emails")?.areaId).toBe("finance"); // 2 of 3 words
    expect(matchLearned(rules, "starred email from Sam")?.areaId).toBe("finance");
    expect(matchLearned(rules, "email Sam")).toBeNull(); // only 1 of 3
    expect(matchLearned(rules, "reply to the landlord")).toBeNull();
  });

  it("an @area you type always beats what was learned", () => {
    const rules = learnFix(undefined, "Call mum", { areaId: "work" });
    expect(applyLearned(u("call mum @family"), rules).area).toBe("family");
  });

  it("works through the whole pipeline", () => {
    const withRules: AppData = { ...data, learned: learnFix(undefined, "Starred email", { areaId: "finance", time: "07:45" }) };
    const p = understand("reply starred email", withRules, NOW);
    expect([p.area, p.dueTime, p.due]).toEqual(["finance", "07:45", T]);
    // unrelated titles are untouched
    expect(understand("reply to client", withRules, NOW).area).toBe("work");
  });

  it("is specific: more words beat fewer, newer beat older", () => {
    let rules = learnFix(undefined, "email", { areaId: "work" }, 1000);
    rules = learnFix(rules, "email landlord", { areaId: "admin" }, 2000);
    expect(matchLearned(rules, "Email landlord about the boiler")?.areaId).toBe("admin");
    expect(matchLearned(rules, "email Sam")?.areaId).toBe("work");
    rules = learnFix(rules, "email landlord", { areaId: "home" }, 3000);
    expect(matchLearned(rules, "email landlord")?.areaId).toBe("home");
    expect(rules.filter((r) => r.words.includes("landlord"))).toHaveLength(1);
  });

  it("ignores sessions, groceries and bills: those aren't filed by area", () => {
    const rules = learnFix(undefined, "milk", { areaId: "work" });
    expect(applyLearned(u("milk khatam"), rules).kind).toBe("grocery");
  });
});
