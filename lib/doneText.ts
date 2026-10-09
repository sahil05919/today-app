import { billKey, dueDates, nextDue } from "./bills";
import { addDays, fromISO, toISO } from "./dates";
import { bestArea, kw, userWordArea } from "./dictionary";
import { dayWord, type DoneTarget, type DoneWhen } from "./done";
import { BILL_ALIASES } from "./intents";
import { matchLearnedItem, STOP } from "./learn";
import { withDefaults } from "./profile";
import { planSessions, plannedForDay, type PlannedSession } from "./schedule";
import { choreKey, entryFor } from "./sessions";
import type { AppData, ISODate } from "./types";

/**
 * Typed (or spoken) ticks: "grocery done", "bought groceries", "room saaf kar diya", "paid credit card",
 * "kal wala Power BI aaj kar liya", "Thursday ka meditation ho gaya", "guitar kiya".
 *
 * The phrase is matched against the CURRENT names of your areas, chores, bills and tasks (plus simple word forms), so a
 * new "Gym" or "Guitar" works the moment you add it. Your learned fixes come first, then the names, then the built-in
 * dictionary. The nearest occurrence that isn't done is ticked: today first, then upcoming days (an early tick), and
 * days back only when you say yesterday / kal (a backdated tick). Pure and offline; Gemini may only help choose between
 * the candidates this returns (lib/ai.ts), never invents one.
 */

export interface DoneCandidate {
  target: DoneTarget;
  when: DoneWhen;
  /** "Grocery run" */
  label: string;
  /** "today", "Saturday", "yesterday", "an extra" */
  dayLabel: string;
  /** What gets remembered if you pick this one: "session:guitar", "bill:grocery", "rhythm:emails", "task:call sam". */
  item: string;
  score: number;
  date: ISODate;
  /** A session with nothing planned: counts as an extra. */
  extra?: boolean;
}

export interface DoneMatch {
  /** Best first. */
  candidates: DoneCandidate[];
  /** Sure enough to act on straight away. When false, ask with a one-tap picker. */
  sure: boolean;
  /** The words that named the thing ("room saaf"), for remembering a correction. */
  phrase: string;
  /** Nothing in the phrase named an item: these are just the open things (for "done" on its own). */
  open?: boolean;
}

// ---- Words -----------------------------------------------------------------------------------------------------

const DONE = kw(
  String.raw`did|done|finished|completed|complete|had|practi[sc]ed|just\s+did|just\s+finished|wrapped\s+up|kiya|kar\s+liya|kar\s+li|kar\s+liye|kar\s+diya|kar\s+dia|kar\s+di|kardiya|ho\s+gay[ai]|ho\s+gya|ho\s+gyi|hogay[ai]|pura\s+kiya|poora\s+kiya|bought|purchased|kharid(?:a|i|\s+liya|\s+li)|khareed(?:a|\s+liya)|le\s+aay[ai]|paid|pay(?:ment)?\s+done|cleared|settled|bhar\s+diya|bhara|bhar\s+di|de\s+diya|chuka\s+diya|jama\s+kar\s+diya|किया|कर\s+लिया|कर\s+ली|कर\s+दिया|कर\s+दी|हो\s+गया|हो\s+गई|पूरा\s+किया|भर\s+दिया|दे\s+दिया|खरीद\s+लिया|ले\s+आया`,
);
/** Past-tense words that really mean "I ticked this off" (not "had lunch with Sam"). */
const STRONG = kw(
  String.raw`done|finished|completed|kiya|kar\s+liya|kar\s+li|kar\s+liye|kar\s+diya|kar\s+dia|kar\s+di|ho\s+gay[ai]|ho\s+gya|ho\s+gyi|hogay[ai]|bought|paid|bhar\s+diya|bhar\s+di|किया|कर\s+लिया|कर\s+दिया|हो\s+गया|भर\s+दिया`,
);
const NEGATED = kw(String.raw`didn'?t|did\s+not|haven'?t|not|never|nahi|nahin|nhi|नहीं|skip(?:ped)?|missed|miss`);
/** "tomorrow" and "next week's" are fine here ("tomorrow's grocery, done today"); plans and promises are not. */
const FUTURE = kw(String.raw`will|going\s+to|gonna|shall|should|need\s+to|have\s+to|want\s+to|must|plan(?:ning)?|remind|karna\s+hai|karni\s+hai|karunga|karungi|karenge|करना\s+है|करनी\s+है`);
const YESTERDAY = kw(String.raw`yesterday|kal|कल|last\s+night`);
const TODAY = kw(String.raw`today|aaj|आज|abhi|just\s+now`);
const TOMORROW = kw(String.raw`tomorrow|tmrw|tomorrow'?s`);

/** Done, Hinglish helpers and day words: these never name the thing. */
const NOISE = new Set(
  (
    "did done finished completed complete had practiced practised just wrapped kiya kar karke liya li liye diya dia di gaya gayi gaye gya gyi ho hogaya hogayi hua hui pura poora " +
    "bhar bhara chuka jama paid pay payment bought purchased kharida kharid khareed liya aaya aayi cleared settled " +
    "today tomorrow tmrw tonight yesterday kal aaj aj parso parson abhi now subah shaam raat morning evening afternoon night " +
    "wala wali wale mera meri mere apna apni apne the my our also already finally " +
    "mon monday tue tues tuesday wed wednesday thu thur thurs thursday fri friday sat saturday sun sunday " +
    "किया कर लिया ली दिया दी गया गई हो पूरा भर दे चुका आज कल"
  ).split(" "),
);

/** Words that are in most names and say little ("Grocery run", "Credit card bill", "Finance review"). */
const GENERIC = new Set(["bill", "bills", "payment", "pay", "run", "session", "sessions", "time", "review", "the", "daily", "weekly", "check"]);

/** Word forms that mean the same thing (Hinglish helpers for everyday chores). */
const SAME: string[][] = [
  ["clean", "saaf", "safai", "safaai", "सफाई", "साफ", "साफ़", "tidy"],
  ["grocery", "ration", "kirana", "ग्रोसरी", "किराना", "राशन", "सब्ज़ी"],
  ["room", "kamra", "kamre", "कमरा", "कमरे"],
  ["walk", "tehel", "tehal", "टहल"],
  ["call", "phone"],
  ["rent", "kiraya", "किराया"],
  ["meditation", "meditate", "dhyan", "ध्यान", "मेडिटेशन"],
  ["read", "padhai", "padha", "पढ़ाई", "पढ़ा"],
  ["exercise", "workout", "gym", "व्यायाम"],
  ["laundry", "kapde", "कपड़े"],
  ["cook", "khana", "kaam"],
];
const SAME_OF = new Map<string, string>(SAME.flatMap((g) => g.map((w) => [w, g[0]] as [string, string])));

const WEEKDAYS: Array<[RegExp, number]> = [
  [kw("sun(?:day)?"), 0],
  [kw("mon(?:day)?"), 1],
  [kw("tue(?:s|sday)?"), 2],
  [kw("wed(?:nesday)?"), 3],
  [kw("thu(?:r|rs|rsday)?"), 4],
  [kw("fri(?:day)?"), 5],
  [kw("sat(?:urday)?"), 6],
];

const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/** "groceries" → "grocery", "walking" → "walk", "emails" → "email"; synonyms fold to one word. */
export function stemWord(w: string): string {
  if (SAME_OF.has(w)) return SAME_OF.get(w)!;
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && /(?:ss|x|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  return SAME_OF.get(s) ?? s;
}

const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** The words of a name that carry meaning, as stems. */
function nameStems(name: string): string[] {
  const all = tokens(name).filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
  const specific = all.filter((t) => !GENERIC.has(t));
  return [...new Set((specific.length ? specific : all).map(stemWord))];
}

/** 0..1: how much of a name is in the phrase. */
function nameScore(name: string, textStems: string[], compact: string): number {
  const stems = nameStems(name);
  if (!stems.length) return 0;
  const hit = stems.filter((w) => textStems.some((t) => same(t, w))).length;
  const joined = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (joined.length >= 4 && compact.includes(joined)) return 1;
  return hit / stems.length;
}

export const looksTicked = (text: string) => DONE.test(text) && !NEGATED.test(text) && !FUTURE.test(text);

// ---- Which day ---------------------------------------------------------------------------------------------------

interface Hint {
  /** A day the phrase pointed at ("kal", "Thursday"). */
  date?: ISODate;
  /** "aaj": done today, whatever day it was for. */
  today: boolean;
}

function hintOf(text: string, today: ISODate): Hint {
  const hint: Hint = { today: TODAY.test(text) };
  if (YESTERDAY.test(text)) {
    hint.date = addDays(today, -1);
    return hint;
  }
  if (TOMORROW.test(text)) {
    hint.date = addDays(today, 1);
    return hint;
  }
  for (const [re, dow] of WEEKDAYS) {
    if (!re.test(text)) continue;
    // The nearest such weekday from two days back to five days ahead.
    for (let i = -2; i <= 5; i++) {
      const d = addDays(today, i);
      if (fromISO(d).getDay() === dow) {
        hint.date = d;
        break;
      }
    }
    break;
  }
  return hint;
}

// ---- Occurrences: the things that can be ticked, and when -----------------------------------------------------

interface Occ {
  date: ISODate;
  target: DoneTarget;
}

interface Entity {
  item: string;
  label: string;
  score: number;
  rank: number;
  /** Open occurrences, oldest first. */
  occs: Occ[];
  /** A session with nothing planned can still be counted: it becomes an extra on that day. */
  synth?: (date: ISODate) => Occ;
  /** Overdue ones come before upcoming ones (bills). */
  overdueFirst?: boolean;
}

const open = (data: AppData, key: string) => {
  const s = entryFor(data.log, key)?.status;
  return s !== "done" && s !== "skip" && s !== "early";
};

/** `boost`: an item to build even when its name isn't in the phrase (a learned phrase, or one the caller already knows). */
function buildEntities(text: string, data: AppData, now: Date, boost: string | null): Entity[] {
  const p = withDefaults(data.profile);
  const today = toISO(now);
  const all = tokens(text).map(stemWord);
  const compact = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const out: Entity[] = [];

  // Sessions: every area with a weekly target (new ones included).
  const ids = new Set(p.areas.filter((a) => a.target).map((a) => a.id));
  if (ids.size) {
    const dict = bestArea(text, ids);
    const mine = userWordArea(text, data.userWords, ids);
    const planned: PlannedSession[] = [];
    let ready = false;
    const load = () => {
      if (ready) return;
      ready = true;
      for (const d of [addDays(today, -2), addDays(today, -1), today]) planned.push(...plannedForDay(data, d).filter((s) => !s.done));
      planned.push(...planSessions(data, now).filter((s) => !s.done && s.date > today));
    };
    for (const a of p.areas.filter((x) => x.target)) {
      const named = Math.max(nameScore(a.name, all, compact), a.id.length >= 4 && compact.includes(a.id.replace(/[^a-z0-9]/g, "")) ? 1 : 0);
      const score = Math.max(named, mine === a.id ? 0.95 : 0, dict && dict.id === a.id && dict.score >= 3 ? 0.75 : 0);
      const e: Entity = {
        item: `session:${a.id}`,
        label: a.name,
        score,
        rank: 0,
        occs: [],
        synth: (date) => ({ date, target: { kind: "session", areaId: a.id, date } }),
      };
      if (score > 0 || e.item === boost) {
        load();
        e.occs = planned.filter((s) => s.areaId === a.id).map((s) => ({ date: s.date, target: { kind: "session", areaId: a.id, date: s.date } as DoneTarget }));
      }
      out.push(e);
    }
  }

  // Bills and chores that repeat.
  for (const b of data.bills ?? []) {
    if (!b.enabled) continue;
    const score = Math.max(nameScore(b.name, all, compact), BILL_ALIASES[b.id] && kw(BILL_ALIASES[b.id]).test(text) ? 1 : 0);
    const e: Entity = { item: `bill:${b.id}`, label: b.name, score, rank: 1, occs: [], overdueFirst: b.kind === "bill" };
    if (score > 0 || e.item === boost) {
      // A real bill that is overdue is still owed; a missed chore only matters for a couple of days.
      const dues = new Set(dueDates(b, addDays(today, b.kind === "bill" ? -7 : -2), addDays(today, 14), today));
      const next = nextDue(b, today);
      if (next) dues.add(next);
      e.occs = [...dues].sort().filter((due) => open(data, billKey(b.id, due))).map((due) => ({ date: due, target: { kind: "bill", id: b.id, due } as DoneTarget }));
    }
    out.push(e);
  }

  // The daily rhythm's tracked check-ins ("Sort emails").
  for (const c of p.rhythm) {
    if (!c.enabled || c.kind !== "chore") continue;
    const score = nameScore(c.label, all, compact);
    const e: Entity = { item: `rhythm:${c.id}`, label: c.label, score, rank: 2, occs: [] };
    if (score > 0 || e.item === boost) {
      for (let i = -2; i <= 7; i++) {
        const d = addDays(today, i);
        if (c.days.includes(fromISO(d).getDay()) && open(data, choreKey(c.id, d))) e.occs.push({ date: d, target: { kind: "rhythm", id: c.id, date: d } });
      }
    }
    out.push(e);
  }

  // Open tasks.
  for (const t of data.tasks) {
    if (t.status !== "open") continue;
    const score = nameScore(t.title, all, compact);
    if (score <= 0 && `task:${t.title.toLowerCase()}` !== boost) continue;
    out.push({ item: `task:${t.title.toLowerCase()}`, label: t.title, score, rank: 3, occs: [{ date: t.due ?? today, target: { kind: "task", id: t.id } }] });
  }
  return out;
}

/** The occurrence to tick for this entity, and how. */
function choose(e: Entity, hint: Hint, today: ISODate): { occ: Occ; when: DoneWhen; extra?: boolean } | null {
  let occ: Occ | undefined;
  let extra = false;
  if (hint.date) occ = e.occs.find((o) => o.date === hint.date);
  if (!occ && hint.date && hint.date <= today && e.synth) {
    occ = e.synth(hint.date);
    extra = true;
  }
  if (!occ) {
    const atToday = e.occs.find((o) => o.date === today);
    const overdue = e.overdueFirst ? e.occs.filter((o) => o.date < today).pop() : undefined;
    occ = atToday ?? overdue ?? e.occs.find((o) => o.date > today);
  }
  if (!occ && e.synth) {
    occ = e.synth(today);
    extra = true;
  }
  if (!occ) return null;
  const when: DoneWhen = occ.date === today ? "on-its-day" : occ.date > today ? "today" : hint.today || !hint.date ? "today" : "backdate";
  return { occ, when, extra };
}

function toCandidate(e: Entity, c: { occ: Occ; when: DoneWhen; extra?: boolean }, today: ISODate): DoneCandidate {
  const day = c.extra && c.occ.date === today ? "an extra" : dayWord(c.occ.date, today);
  return { target: c.occ.target, when: c.when, label: e.label, dayLabel: day, item: e.item, score: e.score, date: c.occ.date, extra: c.extra };
}

/** Everything still open today or overdue: for "done" on its own, or a phrase that names nothing we know. */
function openNow(data: AppData, now: Date): DoneCandidate[] {
  const today = toISO(now);
  const p = withDefaults(data.profile);
  const out: DoneCandidate[] = [];
  const push = (e: { item: string; label: string }, occ: Occ) =>
    out.push({ target: occ.target, when: occ.date > today ? "today" : "on-its-day", label: e.label, dayLabel: dayWord(occ.date, today), item: e.item, score: 0, date: occ.date });
  for (const s of plannedForDay(data, today).filter((x) => !x.done)) {
    const a = p.areas.find((x) => x.id === s.areaId);
    if (a) push({ item: `session:${a.id}`, label: a.name }, { date: today, target: { kind: "session", areaId: a.id, date: today } });
  }
  for (const c of p.rhythm) {
    if (c.enabled && c.kind === "chore" && c.days.includes(fromISO(today).getDay()) && open(data, choreKey(c.id, today))) push({ item: `rhythm:${c.id}`, label: c.label }, { date: today, target: { kind: "rhythm", id: c.id, date: today } });
  }
  for (const b of data.bills ?? []) {
    if (!b.enabled) continue;
    for (const due of dueDates(b, addDays(today, -7), today, today)) if (open(data, billKey(b.id, due))) push({ item: `bill:${b.id}`, label: b.name }, { date: due, target: { kind: "bill", id: b.id, due } });
  }
  for (const t of data.tasks) if (t.status === "open" && t.due && t.due <= today) push({ item: `task:${t.title.toLowerCase()}`, label: t.title }, { date: t.due, target: { kind: "task", id: t.id } });
  return out.slice(0, 14);
}

/**
 * Works out what a "done" phrase ticks. null = it isn't a tick (let the rest of the app handle it).
 * `force`: an item the caller already knows ("session:powerbi" from the older detectors, or from Gemini).
 */
export function matchDone(text: string, data: AppData, now: Date, opts: { force?: string; fallback?: boolean } = {}): DoneMatch | null {
  const today = toISO(now);
  if (!opts.force && !looksTicked(text)) return null;
  if (opts.force && (NEGATED.test(text) || FUTURE.test(text))) return null;
  const hint = hintOf(text, today);
  const content = tokens(text).filter((t) => !NOISE.has(t) && !/^\d+$/.test(t) && !(t.length < 2));
  const phrase = content.join(" ");

  // What you taught it comes first.
  const learned = opts.force ?? matchLearnedItem(data.learned, phrase);
  const entities = buildEntities(text, data, now, learned);
  if (learned) for (const e of entities) if (e.item === learned) e.score = Math.max(e.score, 2);

  const ranked = entities
    .filter((e) => e.score >= 0.5)
    .map((e) => ({ e, c: choose(e, hint, today) }))
    .filter((x): x is { e: Entity; c: NonNullable<ReturnType<typeof choose>> } => !!x.c)
    .sort((a, b) => {
      // A partial name match is weaker than a whole one; then the item that is open soonest; then sessions before the rest.
      const w = (x: { e: Entity }) => (x.e.score >= 1 ? x.e.score : x.e.score * 0.8);
      return w(b) - w(a) || a.c.occ.date.localeCompare(b.c.occ.date) || a.e.rank - b.e.rank;
    });

  if (ranked.length) {
    const candidates = ranked.map((x) => toCandidate(x.e, x.c, today));
    // The best item's other days (upcoming / missed) are there for "Not this one".
    const top = ranked[0].e;
    const others = top.occs.filter((o) => o.date !== ranked[0].c.occ.date).slice(0, 2).map((o) => toCandidate(top, { occ: o, when: o.date > today ? "today" : o.date === today ? "on-its-day" : "backdate" }, today));
    const first = candidates[0];
    const second = candidates.find((c) => c.item !== first.item);
    const sure = !!learned || (first.score >= 0.66 && (!second || first.score - second.score >= 0.25 || second.score < 0.5));
    return { candidates: [...candidates, ...others].slice(0, 8), sure, phrase };
  }

  // Nothing named: "done" alone, or a short strong phrase about something we don't know ("scrubbed floor done").
  const words = tokens(text);
  const strong = STRONG.test(text) && words.length <= 5 && !/\d/.test(text);
  if (!opts.force && opts.fallback && strong) {
    const cands = openNow(data, now);
    if (cands.length) return { candidates: cands, sure: false, phrase, open: true };
  }
  return null;
}
