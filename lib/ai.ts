import { toISO } from "./dates";
import type { ParsedCapture } from "./parse";
import type { Area, ISODate } from "./types";

/**
 * Optional smart parsing with Google's free Gemini API (a key from Google AI Studio).
 * Everything works without it: the rules in parse.ts / hinglish.ts handle capture offline.
 * Gemini is only asked when the rules are unsure, and it can only FILL GAPS (a missing date, an unclear area,
 * a messy title). It never overrides something the rules understood, and it can't create events or touch
 * your shopping list. If the call fails for any reason, the rules' answer is used.
 *
 * Privacy: when this is on, the text you capture (plus today's date and your area names) is sent to Google.
 * The key is stored on this device only, and is not part of your backup file.
 */
const KEY_STORE = "today:gemini-key";
const MODEL_STORE = "today:gemini-model";
export const DEFAULT_MODEL = "gemini-2.5-flash";
/** Tried in order if the chosen model isn't available (names change over time). */
const FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-flash-latest"];
const TIMEOUT_MS = 6000;

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* storage unavailable: AI simply stays off */
  }
};

export const getGeminiKey = () => read(KEY_STORE).trim();
export const setGeminiKey = (k: string) => write(KEY_STORE, k.trim());
export const getGeminiModel = () => read(MODEL_STORE).trim() || DEFAULT_MODEL;
export const setGeminiModel = (m: string) => write(MODEL_STORE, m.trim() === DEFAULT_MODEL ? "" : m.trim());
export const aiEnabled = () => !!getGeminiKey();

/** What Gemini sends back (all optional; we validate each field before using it). */
export interface AiResult {
  title?: string;
  date?: string | null;
  time?: string | null;
  endTime?: string | null;
  important?: boolean;
  areaId?: string | null;
}

/** Rules are "unsure" when they found no date, couldn't pick an area, or the note is long and rambling. */
export function needsAi(rules: ParsedCapture, text: string): boolean {
  if (rules.kind === "grocery") return false; // a plain list, nothing to interpret
  if (rules.kind === "event") return !rules.due || (!rules.event?.start && /\d|baje|बजे|am|pm/i.test(text));
  return !rules.due || rules.area === "others" || text.trim().split(/\s+/).length > 12;
}

export function buildPrompt(text: string, areas: Area[], today: ISODate): string {
  const wd = new Date(today + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" });
  return [
    "You turn one short note from the user (English, Hinglish or Hindi) into JSON for a personal planner.",
    `Today is ${wd} ${today}.`,
    `Areas (use the id): ${areas.map((a) => `${a.id} = ${a.name}`).join("; ")}. If unclear use "others".`,
    "Rules:",
    '- "date": YYYY-MM-DD, only if the note implies a day (kal = tomorrow, parso = day after tomorrow, next Friday, 15th, …). Otherwise null. Never invent one.',
    '- "time": 24-hour HH:mm, only if a time is implied ("6 baje shaam" = 18:00). Otherwise null. "endTime" likewise for a range.',
    '- "title": short, in the same language as the note, WITHOUT date/time words or filler like "karna hai", "yaad dilana", "remind me to".',
    '- "important": true only if the note says it is important/urgent or has "!".',
    "Reply with JSON only.",
    `Note: ${JSON.stringify(text)}`,
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    date: { type: "STRING", nullable: true },
    time: { type: "STRING", nullable: true },
    endTime: { type: "STRING", nullable: true },
    important: { type: "BOOLEAN" },
    areaId: { type: "STRING", nullable: true },
  },
  required: ["title"],
};

export type AiFailure = "no-key" | "offline" | "bad-key" | "rate-limit" | "failed";
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Calls Gemini. Resolves to the parsed JSON, or a short reason it didn't work. Never throws. */
export async function callGemini(prompt: string, opts: { key?: string; model?: string; fetcher?: Fetcher } = {}): Promise<{ ok: true; result: AiResult } | { ok: false; reason: AiFailure }> {
  const key = opts.key ?? getGeminiKey();
  if (!key) return { ok: false, reason: "no-key" };
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const models = [...new Set([opts.model ?? getGeminiModel(), ...FALLBACK_MODELS])];

  for (const model of models) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            // Parsing a note doesn't need deep reasoning; this keeps it quick (only some models accept it).
            ...(model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      });
      if (res.status === 400 || res.status === 403) {
        const text = await res.text().catch(() => "");
        if (/API key|API_KEY|permission|PERMISSION/i.test(text) || res.status === 403) return { ok: false, reason: "bad-key" };
        continue; // a model-specific 400: try the next one
      }
      if (res.status === 429) return { ok: false, reason: "rate-limit" };
      if (res.status === 404) continue; // that model name isn't available any more
      if (!res.ok) return { ok: false, reason: "failed" };
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const parsed = JSON.parse(raw) as AiResult;
      if (!parsed || typeof parsed !== "object") return { ok: false, reason: "failed" };
      return { ok: true, result: parsed };
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline || (e instanceof TypeError && /fetch|network/i.test(String(e.message)))) return { ok: false, reason: "offline" };
      if ((e as { name?: string })?.name === "AbortError") return { ok: false, reason: "offline" }; // too slow: behave as if offline
      return { ok: false, reason: "failed" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "failed" };
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * Fills the gaps in the rules' answer with Gemini's, validating every field. Never overrides what the rules found.
 * Only dates from yesterday to a year ahead are accepted.
 */
export function mergeAi(rules: ParsedCapture, ai: AiResult, areas: Area[], today: ISODate): ParsedCapture {
  const out: ParsedCapture = { ...rules, tags: [...rules.tags] };
  const lo = toISO(new Date(Date.parse(today + "T00:00:00") - 86_400_000));
  const hi = toISO(new Date(Date.parse(today + "T00:00:00") + 400 * 86_400_000));

  if (!rules.due && isDate(ai.date) && ai.date >= lo && ai.date <= hi) {
    out.due = ai.date;
    if (!rules.dueTime && isTime(ai.time)) out.dueTime = ai.time;
    if (!rules.dueEndTime && isTime(ai.endTime) && out.dueTime && ai.endTime > out.dueTime) out.dueEndTime = ai.endTime;
    if (rules.kind === "event" && out.dueTime) out.event = { ...rules.event, start: out.dueTime, end: out.dueEndTime ?? rules.event?.end };
  } else if (rules.due && !rules.dueTime && isTime(ai.time) && rules.kind !== "event") {
    out.dueTime = ai.time; // the day was clear; fill in just the time
  }

  if ((!rules.area || rules.area === "others") && typeof ai.areaId === "string" && areas.some((a) => a.id === ai.areaId)) {
    out.area = ai.areaId;
  }
  if (ai.important === true) out.important = true;

  // A tidier title, only when the rules' one is long or still carries leftover words.
  if (typeof ai.title === "string") {
    const t = ai.title.trim();
    if (t && t.length <= 120 && (rules.title.length > 60 || rules.title.split(/\s+/).length > 9)) out.title = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return out;
}

export type SmartResult = { parsed: ParsedCapture; used: "ai" | "rules"; reason?: AiFailure };

/** Rules first; Gemini only when the rules are unsure and a key is set. Always resolves with something usable. */
export async function smartParse(
  text: string,
  rules: ParsedCapture,
  areas: Area[],
  today: ISODate,
  opts: { fetcher?: Fetcher; key?: string; model?: string } = {},
): Promise<SmartResult> {
  if (!(opts.key ?? getGeminiKey()) || !needsAi(rules, text)) return { parsed: rules, used: "rules" };
  const r = await callGemini(buildPrompt(text, areas, today), opts);
  if (!r.ok) return { parsed: rules, used: "rules", reason: r.reason };
  return { parsed: mergeAi(rules, r.result, areas, today), used: "ai" };
}
