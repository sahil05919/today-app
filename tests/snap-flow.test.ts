import { beforeEach, describe, expect, it } from "vitest";
import { emptyData, migrate } from "../lib/backup";
import { toNativeEvent } from "../lib/calendarWrite";
import { AUTO_SOURCES } from "../lib/autoLog";
import { planNotifications } from "../lib/notifications/plan";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import { pageFromText } from "../lib/snap/clean";
import { addDraft, billTitle, taskFor, type Draft } from "../lib/snap/create";
import { findDuplicate, similarTitles } from "../lib/snap/dup";
import { blocker, emptyState, startSnap, toReview, type ReadResult, type ReviewItem, type SnapDeps, type SnapState } from "../lib/snap/run";
import { getNeverSendImage, setNeverSendImage } from "../lib/snap/settings";
import type { AppData } from "../lib/types";

// Wed 14 Oct 2026, noon (BST). Sat 17 Oct, Tue 20 Oct, Sat 14 Nov 2026.
const NOW = new Date(2026, 9, 14, 12, 0);
const base = (): AppData => seedIfNeeded(emptyData(), NOW);

// ---- a fake phone and a fake Gemini ------------------------------------------------------------------------------------------

const TICKET = "Your tickets\nArctic Monkeys\nO2 Arena, London\nSat 14 Nov 2026\nDoors 18:30  Start 19:30\nTotal £87.50";
const page = (text: string, over: Partial<ReadResult> = {}): ReadResult => ({ ...pageFromText(text), handle: `h-${Math.random().toString(36).slice(2, 8)}`, ...over });

interface Calls {
  ask: Array<{ text?: string; imageBase64?: string; offline: number }>;
  release: string[][];
  jpeg: string[];
}
function fake(pages: Record<string, ReadResult | Error>, over: Partial<SnapDeps> = {}) {
  const calls: Calls = { ask: [], release: [], jpeg: [] };
  const deps: SnapDeps = {
    readImage: async (uri) => {
      const p = pages[uri];
      if (!p) throw new Error("That picture is no longer there");
      if (p instanceof Error) throw p;
      return p;
    },
    getJpeg: async (h) => (calls.jpeg.push(h), "BASE64JPEG"),
    release: async (hs) => void calls.release.push(hs),
    ask: async (i) => (calls.ask.push({ text: i.text, imageBase64: i.imageBase64, offline: i.offline.length }), null),
    online: () => true,
    aiOn: () => true,
    neverImage: () => false,
    now: () => NOW,
    ...over,
  };
  return { deps, calls };
}

function drive(uris: string[], deps: SnapDeps) {
  let state: SnapState = emptyState(uris.length);
  const run = startSnap({ uris, deps, getData: () => base(), onState: (fn) => (state = fn(state)) });
  return { run, get state() { return state; }, set(fn: (s: SnapState) => SnapState) { state = fn(state); } };
}

describe("Snap run: offline first, online only improves", () => {
  it("shows the offline result before Gemini has answered, then improves it", async () => {
    let answer: (v: unknown) => void = () => undefined;
    const { deps } = fake({ a: page(TICKET) }, { ask: () => new Promise((r) => (answer = r)) });
    const d = drive(["a"], deps);
    await new Promise((r) => setTimeout(r, 20));
    // Gemini is still thinking, and the phone's reading is already there to look at.
    expect(d.state.items).toHaveLength(1);
    expect(d.state.items[0]).toMatchObject({ title: "Arctic Monkeys", date: "2026-11-14", start: "19:30", status: "pending" });
    expect(d.state.online).toBe("asking");
    answer({ items: [{ type: "event", title: "Arctic Monkeys", date: "2026-11-14", start: "19:30", location: "The O2 Arena, Greenwich", conf: { title: 0.95, location: 0.95, date: 0.95, start: 0.9 } }] });
    await d.run.done;
    expect(d.state.online).toBe("done");
    expect(d.state.improved).toBe(true);
    expect(d.state.items[0].title).toBe("Arctic Monkeys");
    expect(d.state.items[0].via).toBe("both");
  });

  it("airplane mode: Gemini is never asked, and the result is complete", async () => {
    const { deps, calls } = fake({ a: page(TICKET) }, { online: () => false });
    const d = drive(["a"], deps);
    await d.run.done;
    expect(calls.ask).toEqual([]);
    expect(d.state.items).toHaveLength(1);
    expect(d.state.phase).toBe("ready");
    expect(d.state.online).toBe("off");
  });

  it("no key: Gemini is never asked", async () => {
    const { deps, calls } = fake({ a: page(TICKET) }, { aiOn: () => false });
    await drive(["a"], deps).run.done;
    expect(calls.ask).toEqual([]);
  });

  it("Gemini fails, times out, throws or sends garbage: the offline result stands, silently", async () => {
    for (const ask of [async () => null, async () => { throw new Error("network"); }, async () => "not json", async () => ({ items: "x" })] as Array<SnapDeps["ask"]>) {
      const { deps } = fake({ a: page(TICKET) }, { ask });
      const d = drive(["a"], deps);
      await d.run.done;
      expect(d.state.items).toHaveLength(1);
      expect(d.state.items[0]).toMatchObject({ title: "Arctic Monkeys", date: "2026-11-14", start: "19:30" });
      expect(d.state.items[0].checkDate).toBeUndefined();
      expect(d.state.phase).toBe("ready");
    }
  });

  it("a late Gemini answer never overwrites something you edited", async () => {
    let answer: (v: unknown) => void = () => undefined;
    const { deps } = fake({ a: page(TICKET) }, { ask: () => new Promise((r) => (answer = r)) });
    const d = drive(["a"], deps);
    await new Promise((r) => setTimeout(r, 20));
    d.set((s) => ({ ...s, items: s.items.map((x) => ({ ...x, title: "My own title", edited: true })) }));
    answer({ items: [{ type: "event", title: "Arctic Monkeys Live", date: "2026-11-14", location: "Greenwich", conf: { title: 1, date: 1, location: 1 } }] });
    await d.run.done;
    expect(d.state.items[0].title).toBe("My own title");
    expect(d.state.items[0].location).toBe("O2 Arena, London");
  });
});

describe("Snap run: what is allowed to go online", () => {
  it("only the cleaned TEXT goes, not the picture, when the text is good", async () => {
    const { deps, calls } = fake({ a: page(TICKET) });
    await drive(["a"], deps).run.done;
    expect(calls.ask).toHaveLength(1);
    expect(calls.ask[0].text).toContain("Arctic Monkeys");
    expect(calls.ask[0].imageBase64).toBeUndefined();
    expect(calls.jpeg).toEqual([]);
  });

  it("the picture goes only when the text is too weak to read", async () => {
    const weak = page("| |\n~ •");
    const { deps, calls } = fake({ a: weak });
    await drive(["a"], deps).run.done;
    expect(calls.ask).toHaveLength(1);
    expect(calls.ask[0].imageBase64).toBe("BASE64JPEG");
    expect(calls.ask[0].text).toBeUndefined();
  });

  it("'Never send the picture' keeps it on the phone even when the text is weak", async () => {
    const { deps, calls } = fake({ a: page("| |\n~ •") }, { neverImage: () => true });
    await drive(["a"], deps).run.done;
    expect(calls.ask).toEqual([]); // nothing readable and no picture allowed: nothing to ask about
    expect(calls.jpeg).toEqual([]);
  });

  it("the setting is stored on the phone and defaults to off", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(getNeverSendImage()).toBe(false);
    setNeverSendImage(true);
    expect(getNeverSendImage()).toBe(true);
    setNeverSendImage(false);
    expect(getNeverSendImage()).toBe(false);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(getNeverSendImage()).toBe(false); // no storage: the default, no crash
  });

  for (const [name, text] of [
    ["a card number", "Barclaycard\nPayment due 29 Oct 2026\nNew balance £312.40\nCard 4111 1111 1111 1111"],
    ["a sort code and account number", "Payment due 29 Oct 2026\nPay £312.40\nSort code 20-45-45\nAccount number 12345678"],
    ["an IBAN", "Payment due 29 Oct 2026\nPay £312.40 to IBAN GB82 WEST 1234 5698 7654 32"],
    ["a National Insurance number", "HMRC\nYour NI number AB 12 34 56 C\nPay by 31 Jan 2027 £210.00"],
    ["a passport number", "Booking confirmation\nPassport number: 123456789\nFlight Sat 14 Nov 2026 09:00"],
    ["a password", "Wi-Fi at the venue\nPassword: hunter22\nSat 14 Nov 2026 7pm"],
  ] as const) {
    it(`${name} in the picture: NOTHING goes online (not text, not the picture), and it says so`, async () => {
      const { deps, calls } = fake({ a: page(text) });
      const d = drive(["a"], deps);
      await d.run.done;
      expect(calls.ask).toEqual([]);
      expect(calls.jpeg).toEqual([]);
      expect(d.state.notices.join(" ")).toMatch(/read on this phone only/);
      // …and nothing sensitive is in any text that could be shown or saved.
      expect(d.state.text).not.toMatch(/4111 1111|12345678|20-45-45|WEST 1234|AB 12 34 56|123456789|hunter22/);
      for (const it of d.state.items) expect(JSON.stringify(it)).not.toMatch(/4111 1111|12345678|20-45-45|WEST 1234|AB 12 34 56|123456789|hunter22/);
    });
  }

  it("a weak picture that is sensitive is not sent either (the guard beats the image rule)", async () => {
    // Weak because it is short, sensitive because of the card.
    const { deps, calls } = fake({ a: page("4111 1111 1111 1111") });
    await drive(["a"], deps).run.done;
    expect(calls.ask).toEqual([]);
  });
});

describe("Snap run: many pictures, failures, cancel", () => {
  it("several pictures are read one by one into ONE list, each item knowing its picture", async () => {
    const { deps, calls } = fake({ a: page("King's Talent Bank\nWarehouse assistant shift\nSat 14 Nov 2026 09:00-17:00\n£12.50 per hour"), b: page("party sat 8pm at mine"), c: page("Barclaycard\nPayment due date 29 Oct 2026\nNew balance £500.00") }, { aiOn: () => false });
    const d = drive(["a", "b", "c"], deps);
    await d.run.done;
    expect(d.state.items.map((i) => [i.img, i.type])).toEqual([[0, "shift"], [1, "plan"], [2, "bill"]]);
    expect(d.state.done).toBe(3);
    expect(new Set(d.state.items.map((i) => i.id)).size).toBe(3);
    expect(calls.release).toHaveLength(1);
    expect(calls.release[0]).toHaveLength(3);
  });

  it("a picture that cannot be read gives a calm notice and the others still work", async () => {
    const { deps, calls } = fake({ a: page(TICKET), b: new Error("That picture is no longer there"), c: page("party sat 8pm at mine") }, { aiOn: () => false });
    const d = drive(["a", "b", "c"], deps);
    await d.run.done;
    expect(d.state.items).toHaveLength(2);
    expect(d.state.notices.join(" ")).toMatch(/Picture 2 could not be read/);
    expect(d.state.phase).toBe("ready");
    expect(calls.release[0]).toHaveLength(2);
  });

  it("every picture failing still ends calmly, and still releases", async () => {
    const { deps, calls } = fake({ a: new Error("Today is not allowed to open that picture") });
    const d = drive(["a"], deps);
    await d.run.done;
    expect(d.state.items).toEqual([]);
    expect(d.state.notices).toEqual(["Today is not allowed to open that picture"]);
    expect(d.state.phase).toBe("ready");
    expect(calls.release).toEqual([[]]);
  });

  it("a picture with no text at all says so, and nothing is lost", async () => {
    const { deps } = fake({ a: { width: 1080, height: 2400, lines: [], handle: "h" } });
    const d = drive(["a"], deps);
    await d.run.done;
    expect(d.state.items).toEqual([]);
    expect(d.state.notices[0]).toMatch(/couldn't find any text/);
    expect(d.state.phase).toBe("ready");
  });

  it("text that is not a plan is offered as a note, text kept", async () => {
    const { deps } = fake({ a: page("Buy milk, eggs and bread\nremember bin bags") }, { aiOn: () => false });
    const d = drive(["a"], deps);
    await d.run.done;
    expect(d.state.items[0]).toMatchObject({ type: "note", as: "note" });
    expect(d.state.text).toContain("bin bags");
  });

  it("Cancel frees the pictures and stops: nothing more is read", async () => {
    const order: string[] = [];
    let unblock: () => void = () => undefined;
    const slow = new Promise<void>((r) => (unblock = r));
    const { deps, calls } = fake({ a: page(TICKET), b: page("party sat 8pm at mine") }, {
      aiOn: () => false,
      readImage: async (uri) => {
        order.push(uri);
        if (uri === "b") await slow;
        return page(uri === "a" ? TICKET : "party sat 8pm at mine", { handle: `h-${uri}` });
      },
    });
    const d = drive(["a", "b", "c"], deps);
    await new Promise((r) => setTimeout(r, 20));
    d.run.cancel();
    unblock();
    await d.run.done;
    expect(order).toEqual(["a", "b"]); // c was never opened
    expect(d.state.items).toHaveLength(1); // b finished after the cancel: ignored
    expect(calls.release.flat()).toContain("h-a");
    expect(calls.release.flat()).toContain("h-b");
  });

  it("'tomorrow' counts from the day the picture was taken, and a past day is flagged", async () => {
    const taken = new Date(2026, 9, 10, 9, 0).getTime(); // Sat 10 Oct: tomorrow was Sun 11 Oct
    const { deps } = fake({ a: page("drinks tomorrow 6pm at the Crown", { takenAt: taken }) }, { aiOn: () => false });
    const d = drive(["a"], deps);
    await d.run.done;
    expect(d.state.items[0]).toMatchObject({ date: "2026-10-11", checkDate: true });
  });

  it("a taken-at date in the future (a wrong clock) is ignored, so it cannot push dates out", async () => {
    const { deps } = fake({ a: page("drinks tomorrow 6pm at the Crown", { takenAt: new Date(2027, 5, 1).getTime() }) }, { aiOn: () => false });
    const d = drive(["a"], deps);
    await d.run.done;
    expect(d.state.items[0].date).toBe("2026-10-15");
  });
});

describe("Snap review: what blocks Add", () => {
  const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({ id: "x", img: 0, type: "event", as: "event", title: "Gig", date: "2026-11-14", start: "19:30", conf: {}, allDay: false, status: "pending", edited: false, ...over });
  it("an event with no time must be given one, or marked all-day", () => {
    expect(blocker(item({ start: undefined }))).toMatch(/What time/);
    expect(blocker(item({ start: undefined, allDay: true }))).toBeNull();
    expect(blocker(item())).toBeNull();
  });
  it("an event needs a date; a task does not", () => {
    expect(blocker(item({ date: undefined }))).toMatch(/date/i);
    expect(blocker(item({ date: undefined, as: "task" }))).toBeNull();
  });
  it("a duplicate must be answered first", () => {
    const dup = { kind: "event" as const, title: "Gig", date: "2026-11-14" };
    expect(blocker(item({ dup }))).toMatch(/Already in Today/);
    expect(blocker(item({ dup, dupChoice: "add" }))).toBeNull();
  });
  it("an empty title cannot be added", () => {
    expect(blocker(item({ title: "  " }))).toMatch(/title/i);
  });
});

describe("Snap duplicates", () => {
  const d = (): AppData => ({ ...base(), events: [{ id: "e1", title: "Arctic Monkeys at the O2", date: "2026-11-14", start: "19:30", createdAt: 1 }], calendarEvents: [{ id: "c1", title: "Dentist appointment", date: "2026-10-20", start: "15:00", createdAt: 1, source: "calendar" }] });
  it("says what it found: the same words on the same day", () => {
    expect(findDuplicate(d(), { title: "Arctic Monkeys", date: "2026-11-14" })).toMatchObject({ kind: "event", title: "Arctic Monkeys at the O2" });
    expect(findDuplicate(d(), { title: "Dentist", date: "2026-10-20" })).toMatchObject({ kind: "event", title: "Dentist appointment" }); // an event from the phone's calendar
  });
  it("a different day, a different thing, or no date is not a duplicate", () => {
    expect(findDuplicate(d(), { title: "Arctic Monkeys", date: "2026-11-15" })).toBeNull();
    expect(findDuplicate(d(), { title: "Floating Points", date: "2026-11-14" })).toBeNull();
    expect(findDuplicate(d(), { title: "Arctic Monkeys" })).toBeNull();
  });
  it("an open task counts; a done one does not", () => {
    const t = { id: "t", title: "Pay council tax", due: "2026-11-01", status: "open", important: false, tags: [], steps: [], focus: false, createdAt: 1 } as never;
    expect(findDuplicate({ ...base(), tasks: [t] }, { title: "Pay Council tax bill (£112.40)", date: "2026-11-01" })).toMatchObject({ kind: "task" });
    expect(findDuplicate({ ...base(), tasks: [{ ...(t as object), status: "done" } as never] }, { title: "Pay council tax", date: "2026-11-01" })).toBeNull();
  });
  it("title similarity: containment and shared words, but not unrelated ones", () => {
    expect(similarTitles("Party at mine", "party at mine!")).toBe(true);
    expect(similarTitles("Dentist appointment", "Dentist")).toBe(true);
    expect(similarTitles("Call mum", "Call the bank")).toBe(false);
    expect(similarTitles("", "x")).toBe(false);
  });
  it("a bill that matches one of your recurring bills says so (its reminders exist already)", () => {
    const d2 = base();
    const r = toReview([{ type: "bill", title: "Rent bill", source: undefined, date: "2026-11-01", dueDate: "2026-11-01", conf: {} }], 0, d2);
    expect(r[0].as).toBe("bill");
    expect(r[0].matchesBill).toBeTruthy();
  });
});

describe("Snap creation: confirmed items go through the app's own paths", () => {
  beforeEach(() => actions.replaceAll(base()));
  const ev: Draft = { as: "event", type: "event", title: "Arctic Monkeys", date: "2026-11-14", start: "19:30", location: "O2 Arena, London", amount: 87.5, reference: "12-34567/UK", source: "Ticketmaster", notes: "Doors 18:30" };

  it("an event becomes a fixed event with its place and details, marked as from a snap, and the day is re-planned around it", () => {
    const a = addDraft(ev, NOW);
    const e = getData().events!.find((x) => x.title === "Arctic Monkeys")!;
    expect(e).toMatchObject({ date: "2026-11-14", start: "19:30", location: "O2 Arena, London", src: "snap" });
    expect(e.notes).toContain("Doors 18:30");
    expect(e.notes).toContain("Ref: 12-34567/UK");
    expect(a.summary).toMatch(/Added: Arctic Monkeys.*19:30/);
    // The planner treats it as a fixed block: nothing flexible overlaps it.
    const tl = buildTimeline(getData(), "2026-11-14", NOW);
    const fixed = tl.items.find((i) => i.eventId === e.id)!;
    expect(fixed.fixed).toBe(true);
    for (const i of tl.items) if (!i.fixed && !i.allDay && i.start < fixed.end && fixed.start < i.end) throw new Error(`${i.title} overlaps the event`);
    // Its reminder is planned like any event's.
    expect(planNotifications(getData(), new Date(2026, 10, 13, 8, 0), { budget: Infinity }).some((n) => n.key === `event:${e.id}`)).toBe(true);
  });

  it("an event with no time, chosen as all day, has no start", () => {
    addDraft({ ...ev, start: undefined, allDay: true }, NOW);
    expect(getData().events!.at(-1)).toMatchObject({ date: "2026-11-14", start: undefined });
  });

  it("Undo takes an added event away again", () => {
    const a = addDraft(ev, NOW);
    expect(getData().events).toHaveLength(1);
    a.undo();
    expect(getData().events).toEqual([]);
  });

  it("the event's place and notes reach the phone calendar's entry", () => {
    addDraft(ev, NOW);
    const native = toNativeEvent(getData().events![0], 7);
    expect(native.location).toBe("O2 Arena, London");
    expect(native.description).toContain("Added by Today");
    expect(native.description).toContain("Doors 18:30");
  });

  it("a shift offer becomes a task in Side work, timed, with its length and details in the notes", () => {
    const shift: Draft = { as: "task", type: "shift", title: "Exam invigilator shift", date: "2026-11-24", start: "08:30", end: "12:30", amount: 13.5, location: "UCL, Gower Street", source: "Unitemps", dueDate: "2026-11-20", notes: "£13.50 per hour" };
    addDraft(shift, NOW);
    const t = getData().tasks.find((x) => x.title === "Exam invigilator shift")!;
    expect(t).toMatchObject({ due: "2026-11-24", dueTime: "08:30", area: "sidework", estimateMin: 240, src: "snap", status: "open" });
    expect(t.notes).toContain("From Unitemps");
    expect(t.notes).toContain("Where: UCL, Gower Street");
    expect(t.notes).toContain("Due: 2026-11-20");
    expect(t.notes?.match(/£13\.50/g)).toHaveLength(1); // the rate is not written twice
  });

  it("a timed task gets its reminder like a typed one", () => {
    addDraft({ as: "task", type: "delivery", title: "DPD parcel", date: "2026-10-14", start: "14:10", end: "15:10" }, NOW);
    const t = getData().tasks.find((x) => x.title === "DPD parcel")!;
    expect(planNotifications(getData(), NOW, { budget: Infinity }).some((n) => n.key === `reminder:${t.id}`)).toBe(true);
  });

  it("a task with no time follows the usual rules: no time is made up for it", () => {
    addDraft({ as: "task", type: "deadline", title: "Return the electoral form", date: "2026-11-30" }, NOW);
    const t = getData().tasks.find((x) => x.title === "Return the electoral form")!;
    expect(t).toMatchObject({ due: "2026-11-30", dueTime: undefined, src: "snap" });
  });

  it("a bill becomes 'Pay …' with its amount, due on its due date, in Finance or Life, with the details", () => {
    const bill: Draft = { as: "bill", type: "bill", title: "Council tax bill", date: "2026-10-20", dueDate: "2026-10-20", amount: 112.4, reference: "CT998877", source: "Barnet Council", notes: "Direct Debit" };
    addDraft(bill, NOW);
    const t = getData().tasks.find((x) => x.title.startsWith("Pay Council tax bill"))!;
    expect(t.title).toBe("Pay Council tax bill (£112.40)");
    expect(t).toMatchObject({ due: "2026-10-20", dueTime: undefined, src: "snap" });
    expect(["finance", "life"]).toContain(t.area);
    expect(t.notes).toContain("From Barnet Council");
    expect(t.notes).toContain("Ref: CT998877");
    expect(t.notes).toContain("Direct Debit");
    // The existing reminders pick it up: it is a task due that day.
    expect(planNotifications(getData(), new Date(2026, 9, 19, 8, 0), { budget: Infinity }).some((n) => n.taskId === t.id)).toBe(true);
  });

  it("the bill title is not doubled and not written twice", () => {
    expect(billTitle({ title: "Pay Barclaycard statement", amount: 25 })).toBe("Pay Barclaycard statement (£25.00)");
    expect(billTitle({ title: "Pay rent (£900.00)", amount: 900 })).toBe("Pay rent (£900.00)");
    expect(billTitle({ title: "Energy bill" })).toBe("Pay Energy bill");
  });

  it("a note keeps its text, goes to Ideas & Notes, and has no date", () => {
    addDraft({ as: "note", type: "note", title: "Buy milk, eggs and bread", notes: "Buy milk, eggs and bread\nremember bin bags" }, NOW);
    const t = getData().tasks.find((x) => x.title === "Buy milk, eggs and bread")!;
    expect(t).toMatchObject({ area: "notes", src: "snap", due: undefined });
    expect(t.notes).toContain("bin bags");
  });

  it("a task through the same finishing step as typing: no date gets a sensible slot, not a made-up time before 11:00", () => {
    const p = taskFor({ as: "task", type: "note", title: "Sort the loft" }, getData(), NOW);
    expect(p.due).toBeTruthy();
    if (p.dueTime) expect(p.dueTime >= "11:00").toBe(true);
  });

  it("what a snap makes is yours: not listed in 'What the app did', and it survives a backup and restore", () => {
    expect(AUTO_SOURCES).not.toContain("snap");
    addDraft(ev, NOW);
    addDraft({ as: "task", type: "shift", title: "Steward shift", date: "2026-11-15", start: "10:00" }, NOW);
    expect(getData().auto ?? []).toEqual([]);
    const back = migrate(JSON.parse(JSON.stringify(getData())));
    expect(back.events!.find((e) => e.title === "Arctic Monkeys")).toMatchObject({ location: "O2 Arena, London", src: "snap" });
    expect(back.events!.find((e) => e.title === "Arctic Monkeys")!.notes).toContain("Doors 18:30");
    expect(back.tasks.find((t) => t.title === "Steward shift")?.src).toBe("snap");
  });

  it("nothing is saved by reading: no data changes until an item is added", () => {
    const before = JSON.stringify(getData());
    toReview([{ type: "event", title: "Gig", date: "2026-11-14", start: "19:30", conf: {} }], 0, getData());
    expect(JSON.stringify(getData())).toBe(before);
  });
});
