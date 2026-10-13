import { aiEnabled, callGemini, type Fetcher } from "./ai";
import { buildEntries } from "./entries";
import { catKey, OTHER, SUBS_OF_OTHER } from "./categorise";
import { logError } from "./debugLog";
import { toISO } from "./dates";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";
import type { AppData, SubLabel } from "./types";

/**
 * The last resort of `categorise` (rule 5): Gemini, for titles the built-in words and your learned rules could not place.
 *
 *  - Only when online and a key is set; offline nothing is asked and the item stays Other / Other.
 *  - Only the TITLE of an item is sent (never notes, dates or anything else), plus the list of category names to choose from.
 *  - The answer is cached under the lower-cased title and never asked again.
 *  - Never blocks anything: it runs in the background after the app opens, and at most MAX_PER_OPEN titles per app open.
 */
export const MAX_PER_OPEN = 20;
let askedThisOpen = 0;
/** Tests only. */
export const resetCategoryLookups = () => void (askedThisOpen = 0);

/** The titles still uncategorised (low confidence, fallback, not cached), newest first, each once. */
export function pendingLookups(data: AppData, today: string, max = MAX_PER_OPEN): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const entries = buildEntries(data, today)
    .filter((e) => e.cat.how === "fallback" && (e.kind === "task" || e.kind === "occurrence" || e.kind === "event" || e.kind === "logged"))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const e of entries) {
    const k = catKey(e.title);
    if (!k || seen.has(k) || data.catCache?.[k]) continue;
    seen.add(k);
    out.push(e.title.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

const online = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

export interface LookupOpts {
  fetcher?: Fetcher;
  key?: string;
  model?: string;
  /** Tests: pretend to be offline / online. */
  online?: boolean;
  timeoutMs?: number;
}

/** Asks Gemini for the category of each title. Resolves to what it found (possibly nothing); never throws. */
export async function lookupCategories(titles: string[], data: AppData, opts: LookupOpts = {}): Promise<Record<string, { area: string; sub: SubLabel }>> {
  if (!titles.length || !(opts.online ?? online()) || !(opts.key ?? aiEnabled())) return {};
  const areas = withDefaults(data.profile).areas;
  const ids = [...areas.map((a) => a.id).filter((id) => id !== OTHER), OTHER];
  try {
    const r = await callGemini(
      {
        system:
          "You file short to-do titles under one category each. Categories (id: name): " +
          areas.map((a) => `${a.id}: ${a.name}`).join("; ") +
          `. Use "others" when none fits, and then choose a sub-label: Building (apps, code), Chores (cleaning, cooking), Admin (forms, email, documents), Learning (courses, study) or Other. The titles may be English, Hindi or Hinglish. Answer with one entry per title, using its number.`,
        user: titles.map((t, i) => `${i + 1}. ${t}`).join("\n"),
        schema: {
          type: "OBJECT",
          properties: {
            items: {
              type: "ARRAY",
              items: { type: "OBJECT", properties: { n: { type: "INTEGER" }, area: { type: "STRING", enum: ids }, sub: { type: "STRING", enum: SUBS_OF_OTHER } }, required: ["n", "area"] },
            },
          },
          required: ["items"],
        },
      },
      { timeoutMs: 15_000, ...(opts.fetcher ? { fetcher: opts.fetcher } : {}), ...(opts.key ? { key: opts.key } : {}), ...(opts.model ? { model: opts.model } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) },
    );
    if (!r.ok) return {};
    const items = (r.result as unknown as { items?: Array<{ n?: number; area?: string; sub?: string }> }).items ?? [];
    const out: Record<string, { area: string; sub: SubLabel }> = {};
    for (const it of items) {
      const title = titles[(it.n ?? 0) - 1];
      if (!title || !it.area || !ids.includes(it.area)) continue;
      out[catKey(title)] = { area: it.area, sub: SUB_OK(it.sub) };
    }
    return out;
  } catch (e) {
    logError("catAi", e);
    return {};
  }
}

const SUB_OK = (s?: string): SubLabel => (SUBS_OF_OTHER as string[]).includes(s ?? "") ? (s as SubLabel) : "Other";

/** The app-level job: once per app open, in the background. Resolves to how many titles were filed. */
export async function runCategoryLookups(opts: LookupOpts = {}): Promise<number> {
  const left = MAX_PER_OPEN - askedThisOpen;
  if (left <= 0 || !(opts.online ?? online()) || !(opts.key ?? aiEnabled())) return 0;
  const data = getData();
  const titles = pendingLookups(data, toISO(new Date()), left);
  if (!titles.length) return 0;
  askedThisOpen += titles.length;
  const found = await lookupCategories(titles, data, opts);
  if (Object.keys(found).length) actions.cacheCategories(found);
  return Object.keys(found).length;
}
