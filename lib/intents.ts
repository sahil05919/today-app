import { toISO } from "./dates";
import { bestArea, groceryList, kw, scoreAreas } from "./dictionary";
import { significantWords } from "./learn";
import type { ParsedCapture } from "./parse";
import { withDefaults } from "./profile";
import type { Bill, Profile } from "./types";

/**
 * Intents that aren't "a task with a date": finishing a session, paying a bill, adding to the shopping list,
 * jotting a note. Works in English, Hinglish and Devanagari.
 */

// ---- Words -----------------------------------------------------------------------------------------

const PAST = kw(
  String.raw`did|done|finished|completed|complete|had|practi[sc]ed|just\s+did|just\s+finished|wrapped\s+up|kiya|kar\s+liya|kar\s+li|kar\s+liye|ho\s+gay[ai]|hogay[ai]|pura\s+kiya|poora\s+kiya|किया|कर\s+लिया|कर\s+ली|हो\s+गया|हो\s+गई|पूरा\s+किया|पूरा\s+हो\s+गया`,
);
const NEGATED = kw(String.raw`didn'?t|did\s+not|haven'?t|not|never|nahi|nahin|nhi|नहीं|skip(?:ped)?|missed|miss`);
const FUTURE = kw(String.raw`tomorrow|tmrw|tonight|next|later|will|going\s+to|gonna|shall|should|need\s+to|have\s+to|want\s+to|must|plan(?:ning)?|remind|karna\s+hai|karni\s+hai|karunga|karungi|karenge|करना\s+है|करनी\s+है`);
const YESTERDAY = kw(String.raw`yesterday|kal|कल|last\s+night`);
const PAID = kw(
  String.raw`paid|pay(?:ment)?\s+done|cleared|settled|bhar\s+diya|bhara|bhar\s+di|de\s+diya|chuka\s+diya|pay\s+kar\s+diya|jama\s+kar\s+diya|भर\s+दिया|दे\s+दिया|चुका\s+दिया|भुगतान\s+कर\s+दिया`,
);

/** Date words stripped before checking a shopping phrase: "buy milk tomorrow" is still just milk. */
const WHEN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:today|tomorrow|tonight|tmrw|kal|aaj|parso|आज|कल|(?:on\s+|this\s+|next\s+)?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:this\s+)?weekend|(?:at\s+)?\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}\s?baje|subah|shaam|raat|morning|evening|night|please|pls)(?![\p{L}\p{N}])`,
  "giu",
);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Said in the past tense, not negated, not about the future: "did power bi", "meditation kiya". */
export const looksPast = (text: string) => PAST.test(text) && !NEGATED.test(text) && !FUTURE.test(text);

// ---- Sessions: "did Power BI", "meditation kiya", "walk kar li" ----------------------------------------

export function detectSession(text: string, now: Date, profile: Profile): ParsedCapture | null {
  if (!PAST.test(text) || NEGATED.test(text) || FUTURE.test(text)) return null;
  const sessionIds = new Set(profile.areas.filter((a) => a.target).map((a) => a.id));
  const guess = bestArea(text, sessionIds);
  if (!guess || guess.score < 3) return null;
  const area = profile.areas.find((a) => a.id === guess.id)!;
  // "kal meditation kiya" is yesterday: in the past tense, kal looks backwards.
  const date = YESTERDAY.test(text) ? toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) : toISO(now);
  return { kind: "session", session: { areaId: area.id, date }, title: area.name, important: false, tags: [], area: area.id, areaSource: "guess", source: "rules" };
}

// ---- Bills: "paid rent", "credit card bill bhar diya" ----------------------------------------------

const BILL_ALIASES: Record<string, string> = {
  rent: String.raw`rent|kiraya|किराया|room\s+rent|flat\s+rent`,
  "credit-card": String.raw`credit\s?card|card\s+bill|cc\s+bill|क्रेडिट\s+कार्ड`,
  mobile: String.raw`mobile|phone\s+bill|recharge|मोबाइल`,
};

export function matchBill(text: string, bills: Bill[]): Bill | null {
  for (const b of bills) {
    const alias = BILL_ALIASES[b.id];
    if (alias && kw(alias).test(text)) return b;
  }
  for (const b of bills) {
    if (BILL_ALIASES[b.id]) continue;
    const words = significantWords(b.name).filter((w) => !["bill", "cash", "run", "review", "payment"].includes(w));
    if (words.length && words.every((w) => kw(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(text))) return b;
  }
  return null;
}

export function detectPaid(text: string, bills: Bill[]): ParsedCapture | null {
  if (!PAID.test(text) || NEGATED.test(text) || FUTURE.test(text)) return null;
  const bill = matchBill(text, bills);
  if (!bill) return null;
  return { kind: "paid", paidBillId: bill.id, title: bill.name, important: false, tags: [], area: "finance", areaSource: "guess", source: "rules" };
}

// ---- Groceries: "milk khatam", "need sugar", "out of eggs" --------------------------------------------

export function detectGrocery(raw: string): ParsedCapture | null {
  const t = raw.replace(WHEN, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  if (!t) return null;
  const make = (items: string[] | null): ParsedCapture | null =>
    items && items.length ? { kind: "grocery", groceryItems: items, title: items.join(", "), important: false, tags: [], source: "rules" } : null;

  // "groceries: milk, sugar": explicit, so any words count.
  const prefixed = /^(?:grocery|groceries|shopping(?:\s+list)?|list)\s*[:-]\s*(.+)$/is.exec(raw.trim());
  if (prefixed) return make(prefixed[1].split(/[,;\n]|\s+(?:and|aur|और)\s+/i).map((x) => cap(x.trim())).filter(Boolean));

  // "add X to my shopping list": explicit, so any words count.
  const add = /^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+|my\s+|our\s+)?(?:grocery|groceries|shopping)(?:\s+list)?$/i.exec(t);
  if (add) return make(add[1].split(/[,;]|\s+(?:and|aur|और)\s+/i).map((x) => cap(x.trim())).filter(Boolean));

  // "out of eggs", "need sugar", "running low on rice", "buy milk"
  const need =
    /^(?:(?:we|i)(?:\s+(?:are|am)|'re|'m|’re|’m)?\s+)?(?:out\s+of|ran\s+out\s+of|run\s+out\s+of|running\s+out\s+of|running\s+low\s+on|low\s+on|short\s+of|finished|need|needs|needed|require|want|buy|get|pick\s+up|grab|order|purchase)\s+(.+)$/i.exec(t);
  if (need) {
    const items = groceryList(need[1]);
    if (items) return make(items);
  }

  // Hinglish: "doodh khatam", "chini khatam ho gayi", "atta khatam hai"
  const gone = /^(.+?)\s+(?:khatam|khatm|finish|over|खत्म|ख़त्म)(?:\s+(?:ho|gaya|gayi|gaye|hai|h|hogaya|हो|गया|गई|है))*$/iu.exec(t);
  if (gone) {
    const subject = gone[1].trim();
    // "kaam khatam", "power bi khatam": something other than a pantry item ran out.
    const other = Object.entries(scoreAreas(subject)).some(([id, s]) => s >= 3 && id !== "home" && id !== "shopping");
    if (!other && subject.split(/\s+/).length <= 4) {
      return make(groceryList(subject) ?? subject.split(/[,;]|\s+(?:and|aur|और)\s+/i).map((x) => cap(x.trim())).filter(Boolean));
    }
  }

  // Hinglish: "ghar mein dahi nahi hai", "atta nahi hai", "sugar nahi bachi"
  const none = /^(?:ghar\s+(?:mein|me)\s+)?(.+?)\s+(?:nahi|nahin|nhi|नहीं)\s+(?:hai|hain|bacha|bachi|bache|है)$/iu.exec(t);
  if (none) {
    const items = groceryList(none[1]);
    if (items) return make(items);
  }

  // Hinglish: "doodh lana hai", "sugar chahiye", "chai patti mangwana hai"
  const want = /^(.+?)\s+(?:lena|lana|leni|lani|lene|lane|chahiye|chahie|mangwana|mangana|mangwani|leke\s+aana|le\s+aana|लाना|लेना|चाहिए|मंगवाना)(?:\s+(?:hai|h|hoga|है))?$/iu.exec(t);
  if (want) {
    const items = groceryList(want[1]);
    if (items) return make(items);
  }

  // Just a list of pantry items: "milk, bread and eggs"
  if (t.split(/\s+/).length <= 8) {
    const items = groceryList(t);
    if (items) return make(items);
  }
  return null;
}

// ---- Notes and ideas: "note: wifi password is on the router" ----------------------------------------

export function detectNote(raw: string, profile: Profile): ParsedCapture | null {
  const m = /^\s*(note|idea|remember|thought|memo)\s*[:\-]\s*(.+)$/is.exec(raw);
  if (!m) return null;
  const hasNotes = profile.areas.some((a) => a.id === "notes");
  return {
    kind: "note",
    title: cap(m[2].trim()),
    important: false,
    tags: [],
    area: hasNotes ? "notes" : undefined,
    areaSource: "explicit",
    source: "rules",
    notes: m[1].toLowerCase() === "idea" ? "Idea" : undefined,
  };
}

/** Everything above in priority order, or null when it's an ordinary task. */
export function detectIntent(raw: string, now: Date, profile: Profile | undefined, bills: Bill[]): ParsedCapture | null {
  const me = withDefaults(profile);
  return detectNote(raw, me) ?? detectSession(raw, now, me) ?? detectPaid(raw, bills) ?? detectGrocery(raw);
}
