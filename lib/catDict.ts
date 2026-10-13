import { kw } from "./dictionary";
import type { SubLabel } from "./types";

/**
 * The built-in category words (English + Hinglish) behind `categorise` (lib/categorise.ts) and the search (lib/query.ts).
 * Each group is a weight and a list of words or phrases. A word matches as a whole word (case-insensitive) and also in its plural
 * ("report" matches "reports", "dish" matches "dishes"). A group can also carry a raw regex for forms a plain word cannot say.
 *
 * Where the answer is "Other", `sub` says which kind (Building, Chores, Admin, Learning). The wider word lists in lib/dictionary.ts are
 * used too (see `dictionaryGuess`) so nothing the app understood before is lost; these curated groups win ties.
 */
export interface DictGroup {
  area: string;
  sub?: SubLabel;
  w: number;
  words?: string[];
  /** A raw regex source, matched as a whole word too. */
  re?: string;
}

const NOT_A_BOOKING = String.raw`(?!\s+(?:the\s+|a\s+|my\s+|our\s+)?(?:flights?|trains?|tickets?|hotels?|tables?|appointments?|restaurants?|slots?|rooms?|cabs?|taxis?|dentist|doctor|gp|visa|trip|holiday|tour|seats?|venue|tests?))`;
const NOT_MAIL = String.raw`(?!\s+(?:the\s+)?(?:e-?mails?|mails?|messages?|inbox|invoice|contract|terms))`;

export const CAT_GROUPS: DictGroup[] = [
  // ---- Power BI ----
  { area: "powerbi", w: 5, words: ["power bi", "powerbi", "pbi", "pbix", "dax", "power query", "powerquery", "m query"] },
  { area: "powerbi", w: 3, words: ["dashboard", "slicer", "data model", "measure"] },
  { area: "powerbi", w: 2, words: ["report"] },

  // ---- Meditation ----
  { area: "meditation", w: 5, re: String.raw`meditat\w*|dhyan|dhyaan|mindful\w*|pranayam\w*|vipassana|ध्यान`, words: ["zen"] },
  { area: "meditation", w: 4, words: ["breathing", "breathwork", "breath", "sit quietly"] },

  // ---- Job Prep / Job Apply ----
  { area: "job", w: 5, words: ["interview prep", "star stories", "star story", "leetcode", "sql practice", "linkedin apply", "cv sent", "mock interview", "naukri"] },
  { area: "job", w: 4, words: ["job application", "job search", "job hunt", "resume", "cv", "recruiter", "interview", "cover letter", "referral"] },
  { area: "job", w: 3, words: ["mock"], re: String.raw`appl(?:y|ied|ying|ication)` },

  // ---- English Reading ----
  { area: "english", w: 5, words: ["english reading", "reading"] },
  { area: "english", w: 4, re: `books?${NOT_A_BOOKING}`, words: ["article", "novel", "kitab", "kitaab", "magazine", "newspaper"] },
  { area: "english", w: 3, words: ["padhna", "padhne", "padhai", "padh"] },
  { area: "english", w: 3, re: `read${NOT_MAIL}` },

  // ---- Walking ----
  { area: "walking", w: 5, re: String.raw`walk\w*|stroll\w*|hik(?:e|es|ing)|chalna|chalne|tehal\w*|tehel\w*|ghumne\s+(?:jana|jaana|ja)|टहल\w*`, words: ["step count", "outing"] },
  { area: "walking", w: 3, words: ["steps"] },
  { area: "walking", w: 2, re: String.raw`jog\w*` },

  // ---- Health ----
  { area: "health", w: 4, words: ["gym", "doctor", "gp", "dentist", "vitamin", "medicine", "dawai", "dawa", "workout", "yoga", "physio", "hospital", "clinic", "pharmacy", "prescription", "checkup", "check-up", "optician", "supplement", "exercise"] },
  { area: "health", w: 3, words: ["tablet", "pill", "stretch", "diet", "cardio"] },

  // ---- Finance ----
  { area: "finance", w: 4, words: ["bill", "rent", "bank", "credit card", "debit card", "budget", "kiraya", "paisa", "paise", "kharcha", "salary", "emi", "loan", "invest", "savings", "mortgage", "upi"] },
  { area: "finance", w: 2, words: ["pay", "payment", "transfer"] },

  // ---- Family ----
  { area: "family", w: 5, words: ["call mum", "call mom", "call papa", "call dad", "call family", "call mummy", "call parents"] },
  { area: "family", w: 4, words: ["mum", "mom", "mummy", "papa", "dad", "family", "parents", "bhai", "didi", "behen", "nani", "nana", "dadi", "dada", "cousin"] },
  { area: "family", w: 2, words: ["ghar"] },

  // ---- Life (chores) ----
  { area: "life", sub: "Chores", w: 4, words: ["clean", "cleaning", "laundry", "kapde", "groceries", "grocery", "sabzi", "sabji", "cook", "cooking", "iron", "ironing", "dishes", "vacuum", "tidy", "declutter", "safai", "jhadu", "pocha", "bartan", "dhona", "bedsheet", "bins"] },
  { area: "life", sub: "Chores", w: 3, words: ["khana", "pakana", "fridge", "kitchen", "bathroom", "plants"] },

  // ---- Side work ----
  { area: "sidework", w: 5, words: ["shift", "pinnacle", "unitemps", "kings", "standby", "stand-by"] },
  { area: "sidework", w: 3, words: ["agency", "casual work"] },

  // ---- Other: Building ----
  { area: "others", sub: "Building", w: 4, words: ["app", "code", "coding", "build", "building", "website", "deploy", "repo", "github", "bug", "debug", "develop", "program", "programming"] },
  { area: "others", sub: "Building", w: 2, words: ["project"] },

  // ---- Other: Admin ----
  { area: "others", sub: "Admin", w: 4, words: ["email", "form", "document", "council", "hmrc", "paperwork", "passport", "visa", "insurance", "tenancy", "renew", "certificate", "council tax", "dvla"] },
  { area: "others", sub: "Admin", w: 2, words: ["mail", "letter"] },

  // ---- Other: Learning ----
  { area: "others", sub: "Learning", w: 4, words: ["course", "study", "studying", "tutorial", "udemy", "coursera", "lecture", "class", "exam", "revision", "revise", "learn", "learning", "certification", "seekhna", "sikhna"] },
  { area: "others", sub: "Learning", w: 2, words: ["padhai"] },
];

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "power bi" → a pattern that allows any white space between the words and an optional plural. */
const wordSrc = (w: string) => `${escapeRe(w.trim()).replace(/\s+/g, String.raw`\s+`)}(?:s|es)?`;

const compiled: Array<{ g: DictGroup; re: RegExp }> = CAT_GROUPS.map((g) => {
  const parts = [...(g.words ?? []).map(wordSrc), ...(g.re ? [g.re] : [])];
  return { g, re: kw(parts.join("|")) };
});

export interface DictHit {
  area: string;
  sub?: SubLabel;
  score: number;
}

/** Every area (and Other sub-label) the words point to, strongest first. A second group of the same area adds a little (max + up to 2). */
export function dictionaryHits(text: string): DictHit[] {
  const by = new Map<string, { area: string; sub?: SubLabel; ws: number[] }>();
  for (const { g, re } of compiled) {
    if (!re.test(text)) continue;
    const key = `${g.area}|${g.sub ?? ""}`;
    const cur = by.get(key) ?? { area: g.area, sub: g.sub, ws: [] };
    cur.ws.push(g.w);
    by.set(key, cur);
  }
  return [...by.values()]
    .map((c) => ({ area: c.area, sub: c.sub, score: Math.max(...c.ws) + Math.min(2, c.ws.length - 1) }))
    .sort((a, b) => b.score - a.score);
}

/** The Other sub-label the words suggest (Building, Chores, Admin, Learning), or "Other". */
export function subFromText(text: string): SubLabel {
  const hit = dictionaryHits(text).find((h) => h.sub);
  return hit?.sub ?? "Other";
}
