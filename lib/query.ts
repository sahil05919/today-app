import { addDays, fromISO, toISO } from "./dates";
import { areaFromName, dictionaryGuess, OTHER, type CatCtx } from "./categorise";
import { matchLearnedArea } from "./learn";
import { weekStart } from "./stats";
import type { ISODate, SubLabel } from "./types";

/**
 * Reads what you typed in the search box, offline. Three things come out of a query:
 *   AREA    "pbi", "walk", "chalna", "padhai", "building": the same words as the categories (your learned rules, then the dictionary, then area names)
 *   TIME    today, yesterday, this week (the default), last week, this month, last month, "october", this year, last 30 days
 *   INTENT  how many, left, missed, skipped, next, streak, hours; "added by app" / "from gmail"
 * Anything else is free text. Pure: it never looks at your data.
 */
export type Intent = "howMany" | "left" | "missed" | "skipped" | "next" | "streak" | "time" | "auto" | "gmail";

export interface QueryRange {
  from: ISODate;
  to: ISODate;
  /** "this week", "last week", "October"… */
  label: string;
  kind: "today" | "yesterday" | "week" | "lastWeek" | "month" | "lastMonth" | "year" | "lastDays" | "monthName" | "all";
  /** The query said it (as opposed to the default). */
  explicit: boolean;
}

export interface ParsedQuery {
  raw: string;
  area?: { area: string; sub?: SubLabel };
  range: QueryRange;
  intents: Intent[];
  /** The words left over (lower-case), used to find text and to highlight. */
  words: string[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR: Record<string, number> = { jan: 0, feb: 1, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

const INTENTS: Array<[Intent, RegExp]> = [
  ["auto", /\b(?:added by (?:the )?app|by (?:the )?app|app added|what the app did|app did)\b/],
  ["gmail", /\b(?:from gmail|from my gmail|gmail|from email|from my email)\b/],
  ["howMany", /\b(?:how many|how much|count|kitne|kitni|kitna)\b/],
  ["left", /\b(?:left|remaining|baaki|baki|pending|to go)\b/],
  ["missed", /\b(?:missed|miss|chhoot|chhut)\b/],
  ["skipped", /\b(?:skipped|skip)\b/],
  ["next", /\b(?:next|upcoming|scheduled)\b/],
  ["streak", /\bstreaks?\b/],
  ["time", /\b(?:hours?|hrs?|minutes?|mins?|time spent|ghante|ghanta)\b/],
];

/** Filler words that never help find anything. */
const STOP = new Set(
  "what whats what's show me my the a an did do does i have has had is are was were in on of for to all any there and or with at by about from it this that me. tell find list get give how many much aaj mein me ka ki ke ko hai hain kya".split(" "),
);

const cut = (s: string, re: RegExp): { s: string; m: RegExpExecArray | null } => {
  const m = re.exec(s);
  return m ? { s: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`, m } : { s, m: null };
};

const monthLabel = (iso: ISODate) => fromISO(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** The time part of a query. */
function parseRange(t: string, today: ISODate): { rest: string; range: QueryRange } {
  const monday = weekStart(today);
  const d = fromISO(today);
  let r: ReturnType<typeof cut>;
  const mk = (from: ISODate, to: ISODate, label: string, kind: QueryRange["kind"]) => ({ from, to, label, kind, explicit: true }) as QueryRange;

  if ((r = cut(t, /\b(?:last|past|previous|pichle|pichhle)\s+(\d{1,3})\s+(?:days?|din)\b/)).m) {
    const n = Math.max(1, Math.min(365, Number(r.m![1])));
    return { rest: r.s, range: mk(addDays(today, -(n - 1)), today, `last ${n} days`, "lastDays") };
  }
  if ((r = cut(t, /\b(?:last|previous|pichle|pichhle)\s+(?:week|wk|hafte|hafta)\b/)).m) return { rest: r.s, range: mk(addDays(monday, -7), addDays(monday, -1), "last week", "lastWeek") };
  if ((r = cut(t, /\b(?:this|current|is)\s+(?:week|wk|hafte|hafta)\b/)).m) return { rest: r.s, range: mk(monday, addDays(monday, 6), "this week", "week") };
  if ((r = cut(t, /\b(?:last|previous|pichle|pichhle)\s+(?:month|mahine|mahina)\b/)).m) {
    const first = toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    return { rest: r.s, range: mk(first, toISO(new Date(d.getFullYear(), d.getMonth(), 0)), "last month", "lastMonth") };
  }
  if ((r = cut(t, /\b(?:this|current|is)\s+(?:month|mahine|mahina)\b/)).m) return { rest: r.s, range: mk(toISO(new Date(d.getFullYear(), d.getMonth(), 1)), today, "this month", "month") };
  if ((r = cut(t, /\b(?:this|current|is)\s+(?:year|saal)\b/)).m) return { rest: r.s, range: mk(`${d.getFullYear()}-01-01`, today, "this year", "year") };
  if ((r = cut(t, /\byesterday\b/)).m) return { rest: r.s, range: mk(addDays(today, -1), addDays(today, -1), "yesterday", "yesterday") };
  if ((r = cut(t, /\b(?:today|aaj)\b/)).m) return { rest: r.s, range: mk(today, today, "today", "today") };
  // "october", "oct", "october 2025"
  const names = `${MONTHS.join("|")}|${Object.keys(MONTH_ABBR).join("|")}`;
  if ((r = cut(t, new RegExp(String.raw`\b(?:in\s+)?(${names})(?:\s+(20\d\d))?\b`))).m) {
    const word = r.m![1];
    const idx = MONTHS.indexOf(word) >= 0 ? MONTHS.indexOf(word) : MONTH_ABBR[word];
    // The most recent such month that has started: "november" in October means last November.
    const year = r.m![2] ? Number(r.m![2]) : idx > d.getMonth() ? d.getFullYear() - 1 : d.getFullYear();
    const first = toISO(new Date(year, idx, 1));
    const last = toISO(new Date(year, idx + 1, 0));
    return { rest: r.s, range: mk(first, last > today && first <= today ? today : last, monthLabel(first).replace(/ 20\d\d$/, year === d.getFullYear() ? "" : ` ${year}`), "monthName") };
  }
  return { rest: t, range: { from: monday, to: addDays(monday, 6), label: "this week", kind: "week", explicit: false } };
}

const words = (s: string) => s.split(/[^\p{L}\p{N}#+'-]+/u).map((w) => w.replace(/^[-']+|[-']+$/g, "")).filter(Boolean);

/** The phrase of an area you have, or a sub-label of Other, named in the query. */
function areaByName(t: string, ctx: CatCtx): { area: string; sub?: SubLabel } | null {
  const sub: Array<[RegExp, SubLabel]> = [
    [/\bbuilding\b/, "Building"],
    [/\bchores?\b/, "Chores"],
    [/\badmin\b/, "Admin"],
    [/\blearning\b/, "Learning"],
  ];
  // Names first, longest first ("side work" before "work"), as whole words with an optional plural.
  const named = [...ctx.areas].map((id) => ({ id, name: ctx.names?.[id] ?? id })).sort((a, b) => b.name.length - a.name.length);
  for (const { id, name } of named) {
    if (id === OTHER) continue;
    for (const form of new Set([name.toLowerCase(), id.toLowerCase()])) {
      if (form.length >= 3 && new RegExp(String.raw`(?<![\p{L}\p{N}])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`)}(?:s|es)?(?![\p{L}\p{N}])`, "iu").test(t)) {
        // "learning" and "admin" are both an area (if you kept it) and a kind of Other: the area wins when you have it.
        return { area: id };
      }
    }
  }
  if (/\b(?:others?|misc|miscellaneous)\b/.test(t)) return { area: OTHER };
  for (const [re, s] of sub) if (re.test(t)) return { area: OTHER, sub: s };
  return areaFromName(t, ctx);
}

export function parseQuery(raw: string, ctx: CatCtx, today: ISODate): ParsedQuery {
  let t = ` ${raw.toLowerCase().replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim()} `;
  const intents: Intent[] = [];
  for (const [name, re] of INTENTS) {
    const r = cut(t, re);
    if (r.m) {
      intents.push(name);
      t = r.s;
    }
  }
  const { rest, range } = parseRange(t, today);
  const bare = ` ${words(rest).filter((w) => !STOP.has(w)).join(" ")} `;

  // The area: your names and sub-labels, then what you taught it, then the built-in words.
  let area: ParsedQuery["area"];
  const text = bare.trim();
  if (text) {
    area = areaByName(bare, ctx) ?? undefined;
    if (!area) {
      const learned = matchLearnedArea(ctx.rules, text);
      if (learned?.areaId && (ctx.areas.has(learned.areaId) || learned.areaId === OTHER)) area = { area: learned.areaId, sub: learned.sub };
    }
    if (!area) {
      const g = dictionaryGuess(text, ctx);
      if (g) area = { area: g.area, sub: g.sub };
    }
  }
  return { raw, area, range, intents, words: words(bare).filter((w) => w.length >= 2) };
}

/** The quick chips under an empty search box. */
export const QUICK_CHIPS: Array<{ label: string; query: string }> = [
  { label: "Power BI this week", query: "Power BI this week" },
  { label: "Walks this month", query: "how many walks this month" },
  { label: "What's left this week", query: "what's left this week" },
  { label: "Missed this week", query: "missed this week" },
  { label: "Other this month", query: "other this month" },
  { label: "Added by the app", query: "added by app" },
];
