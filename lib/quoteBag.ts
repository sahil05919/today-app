import { addDays, diffDays, toISO } from "./dates";
import { QUOTES_EN } from "./quotes/en";
import { QUOTES_HI } from "./quotes/hi";
import type { Quote } from "./quotes/types";
import type { AppData, ISODate, QuoteState } from "./types";

/**
 * The quote bag. Quotes come in a shuffled order that never repeats until every one has been used; English and Hinglish
 * alternate. The order is rebuilt from a stored `seed` (so 2000 ids never need saving), `cursor` counts how many slots have
 * been used, and `assigned` pins a date to its slot so re-planning can never change what a date shows.
 * Pure and offline.
 */
export const QUOTE_LIBRARY = { en: QUOTES_EN, hi: QUOTES_HI } as const;
const BY_ID = new Map<string, Quote>([...QUOTES_EN, ...QUOTES_HI].map((q) => [q.id, q]));
export const quoteById = (id: string): Quote | undefined => BY_ID.get(id);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orders = new Map<string, number[]>();
/** The shuffled order of one language's quotes for one pass through the bag. */
function orderFor(lang: "en" | "hi", seed: number, round: number): number[] {
  const k = `${lang}:${seed}:${round}`;
  let o = orders.get(k);
  if (!o) {
    const n = QUOTE_LIBRARY[lang].length;
    o = Array.from({ length: n }, (_, i) => i);
    const r = rng((seed ^ Math.imul(round + 1, 0x9e3779b1) ^ (lang === "en" ? 0x1234567 : 0x7654321)) >>> 0);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [o[i], o[j]] = [o[j], o[i]];
    }
    if (orders.size > 40) orders.clear();
    orders.set(k, o);
  }
  return o;
}

/** The quote in slot `slot`: even slots are English, odd are Hinglish, each walks through its own shuffled bag. */
export function quoteAtSlot(seed: number, slot: number): Quote {
  const lang = slot % 2 === 0 ? "en" : "hi";
  const list = QUOTE_LIBRARY[lang];
  const i = Math.floor(slot / 2);
  return list[orderFor(lang, seed, Math.floor(i / list.length))[i % list.length]];
}

const hash = (n: number) => (Math.imul(n ^ (n >>> 15), 0x2c1b3c6d) >>> 0) || 1;

/** The state to use: what's saved, or a fresh one derived from the install date (no randomness, so planning is stable). */
export function quoteStateOf(data: AppData): QuoteState {
  return (
    data.quotes ?? {
      seed: hash(Math.floor(data.settings.firstRunAt / 1000)),
      cursor: 0,
      assigned: {},
      saved: [],
      anchor: toISO(new Date(data.settings.firstRunAt)),
    }
  );
}

/** Does a quote go out on this date, with a quote every `every` days (counted from the anchor)? */
export function isQuoteDay(state: QuoteState, date: ISODate, every: number): boolean {
  if (!every) return false;
  const d = diffDays(date, state.anchor ?? date);
  return d >= 0 && d % every === 0;
}

/** The slot a date shows: pinned if it has been shown, else the next free slots in date order (so it is stable until then). */
export function slotForDate(state: QuoteState, date: ISODate, every: number, today: ISODate): number {
  const pinned = state.assigned[date];
  if (pinned !== undefined) return pinned;
  let ahead = 0;
  for (let d = today; d < date; d = addDays(d, 1)) {
    if (isQuoteDay(state, d, every) && state.assigned[d] === undefined) ahead++;
  }
  return state.cursor + ahead;
}

export const quoteForDate = (state: QuoteState, date: ISODate, every: number, today: ISODate): Quote => quoteAtSlot(state.seed, slotForDate(state, date, every, today));

/** Pins a date to the next slot (when its quote is shown). Does nothing if it is already pinned. */
export function assignDate(state: QuoteState, date: ISODate): QuoteState {
  if (state.assigned[date] !== undefined) return state;
  const assigned = { ...state.assigned, [date]: state.cursor };
  // Keep the map small: dates older than ~120 entries are forgotten.
  const keys = Object.keys(assigned).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete assigned[k];
  return { ...state, assigned, cursor: state.cursor + 1 };
}

/** "Another one": takes the next unused slot. */
export function takeAnother(state: QuoteState): { state: QuoteState; quote: Quote } {
  return { state: { ...state, cursor: state.cursor + 1 }, quote: quoteAtSlot(state.seed, state.cursor) };
}

/** Quote text for a notification or card: "text — Author". */
export const quoteLine = (q: Quote) => (q.author ? `${q.text} — ${q.author}` : q.text);
