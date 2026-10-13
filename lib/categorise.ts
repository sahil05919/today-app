import { dictionaryHits, subFromText } from "./catDict";
import { scoreAreas } from "./dictionary";
import { matchLearnedArea } from "./learn";
import { cached } from "./memo";
import { withDefaults } from "./profile";
import type { AppData, CatCacheEntry, CatHow, CatPick, Category, Confidence, LearnedRule, SubLabel, UserWord } from "./types";

/**
 * ONE function decides which area (and, for Other, which sub-label) an item belongs to, and how sure that is. The order is fixed:
 *
 *   1. explicit   an area you picked, a #tag in the text, an "area:" line (Gmail tasks)          → high
 *   2. inherited  sessions, repeats, occurrences, bills keep their own area                      → high
 *   3. learned    words from an item you re-categorised before ("gym" → Health)                  → high
 *   4. dictionary the built-in words, English + Hinglish (lib/catDict.ts, lib/dictionary.ts)     → medium
 *   5. gemini     an answer cached from an earlier lookup (only ever asked online, see catAi.ts) → low
 *   6. fallback   Other / Other                                                                  → low
 *
 * Pure: no clock, no storage, no network.
 */
export const OTHER = "others";

export interface CatItem {
  /** The key a hand-picked category is stored under ("task:<id>", "event:<key>", "log:<id>"…). */
  key?: string;
  title: string;
  notes?: string;
  tags?: string[];
  /** The area stored on the item. "others" or nothing counts as "not chosen". */
  area?: string;
  /** How that stored area was decided (default: you chose it). */
  how?: CatHow;
  /** The stored area belongs to a session / repeat / occurrence / bill: it is inherited, not chosen. */
  inherited?: boolean;
  /** A sub-label already known for an Other item. */
  sub?: SubLabel;
}

export interface CatCtx {
  /** The ids of the areas you have. */
  areas: ReadonlySet<string>;
  /** id → display name (for "area: Side work" lines). */
  names?: Readonly<Record<string, string>>;
  rules?: readonly LearnedRule[];
  userWords?: readonly UserWord[];
  picks?: Readonly<Record<string, CatPick>>;
  cache?: Readonly<Record<string, CatCacheEntry>>;
}

const CONF: Record<CatHow, Confidence> = { explicit: "high", inherited: "high", learned: "high", dictionary: "medium", gemini: "low", fallback: "low" };
export const confidenceOf = (how: CatHow): Confidence => CONF[how];

export const SUBS_OF_OTHER: SubLabel[] = ["Building", "Chores", "Admin", "Learning", "Other"];

/** What an area implies for the sub-label when it is not "Other". */
const NATURAL_SUB: Record<string, SubLabel> = { life: "Chores", home: "Chores", admin: "Admin", learning: "Learning" };

/** The lookup key of a title in the Gemini cache. */
export const catKey = (title: string) => title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

/** #tag → area id (and sub-label). Also any area id or name, without spaces. */
const TAG_AREAS: Record<string, { area: string; sub?: SubLabel }> = {
  pbi: { area: "powerbi" },
  powerbi: { area: "powerbi" },
  meditation: { area: "meditation" },
  meditate: { area: "meditation" },
  job: { area: "job" },
  jobs: { area: "job" },
  english: { area: "english" },
  reading: { area: "english" },
  walk: { area: "walking" },
  walking: { area: "walking" },
  health: { area: "health" },
  gym: { area: "health" },
  finance: { area: "finance" },
  money: { area: "finance" },
  family: { area: "family" },
  life: { area: "life", sub: "Chores" },
  chores: { area: "life", sub: "Chores" },
  sidework: { area: "sidework" },
  "side-work": { area: "sidework" },
  work: { area: "work" },
  career: { area: "career" },
  other: { area: OTHER },
  others: { area: OTHER },
  building: { area: OTHER, sub: "Building" },
  admin: { area: OTHER, sub: "Admin" },
  learning: { area: OTHER, sub: "Learning" },
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** An area id from a word or name ("Side work", "pbi", "Power BI"), or null. */
export function areaFromName(name: string, ctx: Pick<CatCtx, "areas" | "names">): { area: string; sub?: SubLabel } | null {
  const k = name.toLowerCase().trim();
  if (!k) return null;
  const n = norm(k);
  for (const id of ctx.areas) if (id === k || norm(id) === n || (ctx.names?.[id] && norm(ctx.names[id]) === n)) return { area: id };
  const t = TAG_AREAS[k.replace(/\s+/g, "")] ?? TAG_AREAS[n];
  if (t) return ctx.areas.has(t.area) || t.area === OTHER ? t : { area: OTHER, sub: t.sub };
  return null;
}

/** An explicit choice written in the text: a #tag, or an "area:" line. */
export function explicitFromText(item: Pick<CatItem, "title" | "notes" | "tags">, ctx: Pick<CatCtx, "areas" | "names">): { area: string; sub?: SubLabel } | null {
  const line = /^\s*area\s*:\s*(.+?)\s*$/im.exec(item.notes ?? "")?.[1];
  if (line) {
    const a = areaFromName(line, ctx);
    if (a) return a;
  }
  const tags = [...(item.tags ?? []), ...[...(`${item.title} ${item.notes ?? ""}`.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu))].map((m) => m[1])];
  for (const t of tags) {
    const a = areaFromName(t.replace(/^#/, ""), ctx);
    if (a) return a;
  }
  return null;
}

const CURATED_BONUS = 3;

/** The dictionary's answer for some words among the areas you have: the curated groups and the older word lists, strongest first. */
export function dictionaryGuess(text: string, ctx: Pick<CatCtx, "areas" | "userWords">): { area: string; sub?: SubLabel; score: number } | null {
  const cands: Array<{ area: string; sub?: SubLabel; score: number; order: number }> = [];
  let order = 0;
  for (const h of dictionaryHits(text)) {
    // The area is one you have; if not (Life / Side work were removed), the words still say what KIND of thing it is, so Other.
    // The curated groups are the ones asked for by name, so they get a head start over the older, wider lists.
    const score = h.score + CURATED_BONUS;
    if (h.area === OTHER || ctx.areas.has(h.area)) cands.push({ ...h, score, order: order++ });
    else if (h.area === "life" && ctx.areas.has("home")) cands.push({ area: "home", sub: "Chores", score, order: order++ });
    else if (h.sub) cands.push({ area: OTHER, sub: h.sub, score, order: order++ });
  }
  // Words you taught the dictionary (My dictionary) count a lot: they are yours.
  for (const u of ctx.userWords ?? []) {
    if (u.word && ctx.areas.has(u.areaId) && new RegExp(`(?<![\\p{L}\\p{N}_])${u.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu").test(text)) cands.push({ area: u.areaId, score: 6, order: order++ });
  }
  // The wider lists (work, home, travel, shopping…) fill in what the curated groups do not know.
  for (const [area, score] of Object.entries(scoreAreas(text))) {
    if (score >= 2 && ctx.areas.has(area)) cands.push({ area, score, order: order++ });
  }
  cands.sort((a, b) => b.score - a.score || a.order - b.order);
  const best = cands[0];
  return best && best.score >= 2 ? { area: best.area, sub: best.sub, score: best.score } : null;
}

function result(area: string, sub: SubLabel | undefined, how: CatHow, text: string): Category {
  const s = area === OTHER ? (sub && sub !== "Other" ? sub : subFromText(text)) : (NATURAL_SUB[area] ?? "Other");
  return { area, sub: s, conf: CONF[how], how };
}

export function categorise(item: CatItem, ctx: CatCtx): Category {
  const text = `${item.title} ${item.notes ?? ""}`.trim();
  const have = (a?: string): a is string => !!a && (ctx.areas.has(a) || a === OTHER);

  // 1. Explicit: a pick you made, a #tag or "area:" line, an area stored on the item that you chose.
  const pick = item.key ? ctx.picks?.[item.key] : undefined;
  if (pick && have(pick.area)) return result(pick.area, pick.sub ?? item.sub, "explicit", text);
  const tagged = explicitFromText(item, ctx);
  if (tagged) return result(tagged.area, tagged.sub ?? item.sub, "explicit", text);
  const stored = have(item.area) && item.area !== OTHER ? item.area : undefined;
  if (stored && item.inherited) return result(stored, item.sub, "inherited", text);
  const how = item.how ?? "explicit";
  if (stored && (how === "explicit" || how === "learned")) return result(stored, item.sub, how, text);

  // 3. Learned: a correction you made before beats the built-in words (and a guess stored earlier).
  const rule = matchLearnedArea(ctx.rules, item.title);
  if (rule?.areaId && have(rule.areaId)) return result(rule.areaId, rule.sub ?? item.sub, "learned", text);

  // 4. Dictionary (a guess stored on the item at capture time is the dictionary's own earlier answer).
  const d = dictionaryGuess(text, ctx);
  if (d) return result(d.area, d.sub ?? item.sub, "dictionary", text);
  if (stored) return result(stored, item.sub, how === "gemini" ? "gemini" : "dictionary", text);

  // 5. Gemini, from the cache.
  const g = ctx.cache?.[catKey(item.title)];
  if (g && have(g.area)) return result(g.area, g.sub, "gemini", text);

  // 6. Offline / unknown.
  return result(OTHER, item.sub, "fallback", text);
}

// ---- Context from the data -----------------------------------------------------------------------------------------------------------

/** The context for `categorise`, built once per data snapshot. */
export function catCtx(data: AppData): CatCtx {
  return cached(data, "catCtx", () => {
    const areas = withDefaults(data.profile).areas;
    return {
      areas: new Set(areas.map((a) => a.id).concat(OTHER)),
      names: Object.fromEntries(areas.map((a) => [a.id, a.name])),
      rules: data.learned,
      userWords: data.userWords,
      picks: data.catPicks,
      cache: data.catCache,
    };
  });
}

/** What the chip shows: "📊 Power BI", "🧳 Side work", "📥 Other · Building". */
export function categoryLabel(data: AppData, c: Category): { emoji: string; name: string; text: string } {
  const a = withDefaults(data.profile).areas.find((x) => x.id === c.area);
  const name = c.area === OTHER ? "Other" : (a?.name ?? c.area);
  const emoji = c.area === OTHER ? "📥" : (a?.emoji ?? "•");
  const text = c.area === OTHER && c.sub !== "Other" ? `${name} · ${c.sub}` : name;
  return { emoji, name, text };
}
