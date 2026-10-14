import { describe, expect, it } from "vitest";
import { mergeItems, validateGemini, validateItem } from "../lib/snap/merge";
import { SNAP_SCHEMA, buildSnapPrompt } from "../lib/snap/gemini";
import { SNAP_TYPES, type SnapItem } from "../lib/snap/types";

// Wed 14 Oct 2026, noon.
const NOW = new Date(2026, 9, 14, 12, 0);
const offline = (over: Partial<SnapItem> = {}): SnapItem => ({
  type: "event",
  title: "Arctic Monkeys",
  date: "2026-11-14",
  start: "19:30",
  location: "O2 Arena",
  amount: 87.5,
  conf: { title: 0.55, date: 0.8, start: 0.9, location: 0.5, amount: 0.9 },
  ...over,
});
const gem = (over: Record<string, unknown> = {}, conf: Record<string, number> = {}) => ({
  items: [{ type: "event", title: "Arctic Monkeys", date: "2026-11-14", start: "19:30", location: "The O2 Arena, London", amount: 87.5, conf: { title: 0.9, date: 0.95, start: 0.9, location: 0.9, amount: 0.95, ...conf }, ...over }],
});

describe("Snap merge: a garbage answer from Gemini changes nothing", () => {
  const base = [offline()];
  const garbage: unknown[] = [
    null,
    undefined,
    "",
    "Sorry, I can't help with that.",
    "{not json",
    42,
    true,
    [],
    {},
    { items: null },
    { items: "x" },
    { items: {} },
    { items: [] },
    { items: [null, 5, "x", [], {}] },
    { items: [{ type: "bogus", title: "Real title here", date: "2026-11-14" }] },
    { items: [{ type: "event", title: "", date: "2026-11-14" }] },
    { items: [{ type: "event", title: "12", date: "2026-11-14" }] },
    { items: [{ type: "event", title: "Real title here" }] }, // nothing to put in a planner
    { items: [{ type: "event", title: "Real title here", date: "2026-13-45" }] },
    { items: [{ type: "event", title: "Real title here", date: "14/11/2026" }] },
    { items: [{ type: "event", title: "Real title here", date: "2099-01-01" }] },
    { items: [{ type: "event", title: "Real title here", date: "1999-01-01" }] },
    { items: [{ type: "event", title: "x".repeat(500), date: "2026-11-14" }] },
    { items: [{ type: "event", title: "Real title here", amount: "12.50" }] },
    { items: [{ type: "event", title: "Real title here", amount: -5 }] },
    { items: [{ type: "event", title: "Real title here", amount: Number.NaN }] },
    { items: [{ type: "event", title: "Real title here", amount: 1e12 }] },
  ];
  for (const [i, g] of garbage.entries()) {
    it(`garbage #${i + 1}: ${JSON.stringify(g)?.slice(0, 60)}`, () => {
      const r = mergeItems(base, g, NOW);
      expect(r.items).toEqual(base);
      expect(r.changed).toBe(false);
    });
  }

  it("a response that is not even an object, or whose items throw on access, never throws", () => {
    const evil = { get items(): unknown { throw new Error("boom"); } };
    expect(() => mergeItems(base, evil, NOW)).not.toThrow();
  });
});

describe("Snap merge: field validation", () => {
  it("an item keeps its valid fields and drops the invalid ones", () => {
    const v = validateItem({ type: "bill", title: "British Gas bill", date: "2026-11-15", start: "25:99", end: "10:00", amount: "abc", reference: "has spaces", location: 5, conf: { title: 7, date: -1 } }, NOW)!;
    expect(v).toMatchObject({ type: "bill", title: "British Gas bill", date: "2026-11-15", via: "gemini" });
    expect(v.start).toBeUndefined();
    expect(v.end).toBeUndefined(); // no start, so no end
    expect(v.amount).toBeUndefined();
    expect(v.reference).toBeUndefined();
    expect(v.location).toBeUndefined();
    // Confidences are clamped to 0..1; a missing one is "fairly sure", never "certain".
    expect(v.conf.title).toBe(1);
    expect(v.conf.date).toBe(0);
  });

  it("an end at or before the start is dropped; a good range is kept; amounts are rounded to pence", () => {
    expect(validateItem({ type: "shift", title: "Steward shift", date: "2026-11-15", start: "10:00", end: "09:00" }, NOW)!.end).toBeUndefined();
    expect(validateItem({ type: "shift", title: "Steward shift", date: "2026-11-15", start: "10:00", end: "16:00", amount: 12.499 }, NOW)).toMatchObject({ end: "16:00", amount: 12.5 });
  });

  it("at most 12 entries are read, and an unknown type is dropped but the rest survive", () => {
    const many = { items: Array.from({ length: 30 }, (_, i) => ({ type: "event", title: `Event number ${i}`, date: "2026-11-14" })) };
    expect(validateGemini(many, NOW)).toHaveLength(12);
    const mixed = { items: [{ type: "weird", title: "Nope nope", date: "2026-11-14" }, { type: "note", title: "Keep this one", date: "2026-11-14" }] };
    expect(validateGemini(mixed, NOW).map((i) => i.title)).toEqual(["Keep this one"]);
  });

  it("every allowed type is in the response schema, and the schema has the same fields as an item", () => {
    const props = (SNAP_SCHEMA.properties.items.items as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.type.enum).toEqual(SNAP_TYPES);
    for (const f of ["title", "date", "start", "end", "location", "amount", "dueDate", "reference", "source", "notes", "conf"]) expect(props, f).toHaveProperty(f);
  });

  it("the prompt says what today is, when the picture was taken, and never to invent", () => {
    const p = buildSnapPrompt(new Date(2026, 9, 10), NOW, []);
    expect(p).toContain("2026-10-14");
    expect(p).toContain("2026-10-10");
    expect(p).toMatch(/NEVER invent/);
    expect(p).toMatch(/day first/);
  });
});

describe("Snap merge: how the two readings are combined", () => {
  it("a Gemini field replaces an offline one only when valid AND more confident", () => {
    const r = mergeItems([offline({ title: "Arctic Monkeys gig", conf: { title: 0.55, date: 0.8, start: 0.9 }, location: undefined })], gem(), NOW);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].title).toBe("Arctic Monkeys"); // 0.9 beats 0.55
    expect(r.items[0].location).toBe("The O2 Arena, London"); // the phone found none
    expect(r.items[0].via).toBe("both");
    expect(r.changed).toBe(true);
  });

  it("a less confident Gemini field does NOT replace the offline one", () => {
    const r = mergeItems([offline({ conf: { title: 0.95, date: 0.9, start: 0.9, location: 0.9, amount: 0.9 } })], gem({}, { title: 0.5, location: 0.5 }), NOW);
    expect(r.items[0].title).toBe("Arctic Monkeys");
    expect(r.items[0].location).toBe("O2 Arena");
  });

  it("when the day differs, the PHONE's date stays, flagged 'check date', with what Gemini read", () => {
    const r = mergeItems([offline()], gem({ date: "2026-11-21" }), NOW);
    expect(r.items[0].date).toBe("2026-11-14");
    expect(r.items[0].checkDate).toBe(true);
    expect(r.items[0].alt).toEqual({ date: "2026-11-21" });
  });

  it("when the time differs, the phone's time stays, flagged", () => {
    const r = mergeItems([offline()], gem({ start: "20:00" }), NOW);
    expect(r.items[0].start).toBe("19:30");
    expect(r.items[0].checkDate).toBe(true);
    expect(r.items[0].alt).toEqual({ start: "20:00" });
  });

  it("even a very confident Gemini never swaps a date or time quietly", () => {
    const r = mergeItems([offline({ conf: { title: 0.5, date: 0.1, start: 0.1 } })], gem({ date: "2026-12-01", start: "21:00" }, { date: 1, start: 1 }), NOW);
    expect(r.items[0]).toMatchObject({ date: "2026-11-14", start: "19:30", checkDate: true });
  });

  it("Gemini fills a time or a place the phone could not find", () => {
    const r = mergeItems([offline({ start: undefined, location: undefined, conf: { title: 0.6, date: 0.8 } })], gem(), NOW);
    expect(r.items[0]).toMatchObject({ start: "19:30", location: "The O2 Arena, London" });
    expect(r.items[0].conf.start).toBe(0.9);
  });

  it("agreement raises the confidence to the higher of the two", () => {
    const r = mergeItems([offline()], gem(), NOW);
    expect(r.items[0].conf.date).toBe(0.95);
    expect(r.items[0].conf.amount).toBe(0.95);
    expect(r.items[0].checkDate).toBeUndefined();
  });

  it("a vague 'plan' becomes the specific kind Gemini saw; a specific kind is not changed by Gemini", () => {
    expect(mergeItems([offline({ type: "plan" })], gem({ type: "appointment" }), NOW).items[0].type).toBe("appointment");
    expect(mergeItems([offline({ type: "event" })], gem({ type: "appointment" }), NOW).items[0].type).toBe("event");
  });

  it("items only Gemini found are added only when the phone found nothing, or Gemini is very sure", () => {
    const g = gem({ title: "Quiz night at the Crown", date: "2026-11-02" }, { title: 0.7, date: 0.7 });
    expect(mergeItems([], g, NOW).items.map((i) => i.title)).toEqual(["Quiz night at the Crown"]);
    expect(mergeItems([offline({ title: "Something else", date: "2026-12-25" })], g, NOW).items).toHaveLength(1);
    const sure = gem({ title: "Quiz night at the Crown", date: "2026-11-02" }, { title: 0.95, date: 0.95 });
    expect(mergeItems([offline({ title: "Something else", date: "2026-12-25" })], sure, NOW).items).toHaveLength(2);
  });

  it("a list: each offline item is matched to its own Gemini item, in order", () => {
    const a = offline({ title: "Warehouse shift", date: "2026-11-14", type: "shift" });
    const b = offline({ title: "Steward shift", date: "2026-11-15", type: "shift" });
    const g = {
      items: [
        { type: "shift", title: "Steward shift (King's)", date: "2026-11-15", location: "Wembley", conf: { title: 0.9, date: 0.9, location: 0.9 } },
        { type: "shift", title: "Warehouse shift", date: "2026-11-14", location: "Park Royal", conf: { title: 0.9, date: 0.9, location: 0.9 } },
      ],
    };
    const r = mergeItems([a, b], g, NOW);
    expect(r.items.map((i) => [i.title, i.location])).toEqual([
      ["Warehouse shift", "Park Royal"],
      ["Steward shift (King's)", "Wembley"],
    ]);
  });

  it("a day already past is flagged whoever read it", () => {
    const r = mergeItems([offline({ date: "2026-10-03", conf: { title: 0.5, date: 0.9 } })], gem({ date: "2026-10-03" }), NOW);
    expect(r.items[0].checkDate).toBe(true);
    // …but an overdue BILL is simply overdue.
    const bill = mergeItems([offline({ type: "bill", date: "2026-10-03", dueDate: "2026-10-03" })], gem({ type: "bill", date: "2026-10-03" }), NOW);
    expect(bill.items[0].checkDate).toBeUndefined();
  });

  it("the offline items are never mutated", () => {
    const o = offline();
    const copy = JSON.parse(JSON.stringify(o));
    mergeItems([o], gem({ date: "2026-11-21", title: "Totally different", location: "Elsewhere" }), NOW);
    expect(o).toEqual(copy);
  });
});
