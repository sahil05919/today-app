import { toISO } from "./dates";
import { plannedForDay } from "./schedule";
import { describeSchedule } from "./bills";
import { eventsOn, inferCountsFor } from "./fixed";
import { looksPast, matchBill } from "./intents";
import type { ParsedCapture } from "./parse";
import { extractRecurrence, firstOccurrence } from "./recur";
import { significantWords } from "./learn";
import { toHHMM, toMin, withDefaults } from "./profile";
import { finalize } from "./understand";
import type { AppData, ISODate } from "./types";

/**
 * Gemini (Google's free tier) as an optional, smarter reader of what you type or say.
 *
 *  - The key lives only on this device (localStorage). It is never in the code, the repo, a log or your backup.
 *  - It's sent with a short system prompt describing you: areas and weekly targets, daily rhythm, work hours,
 *    bills, today's date/time, and today's and tomorrow's schedule. It returns structured JSON.
 *  - 5-second timeout. Offline, slow, rate-limited or any failure: the offline rules answer is used, silently.
 *  - Its answer goes through the same last steps as the rules (your learned fixes, then a sensible time),
 *    and every field is validated first, so a wrong guess can't break anything.
 */
const KEY_STORE = "today:gemini-key";
/** A model name typed by hand under Settings → Advanced. Empty means "pick one automatically". */
const MODEL_STORE = "today:gemini-model";
/** The model picked from Google's ListModels result, remembered per key ("<last 8 of key>|<model>"). */
const AUTO_STORE = "today:gemini-auto-model";
const API = "https://generativelanguage.googleapis.com/v1beta";
export const TIMEOUT_MS = 5000;
/** Test key and model discovery can take longer than a capture, which has to stay snappy. */
export const TEST_TIMEOUT_MS = 15000;

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

/**
 * A pasted key often carries a trailing space or newline (or quote marks). A key never contains whitespace,
 * so all of it is removed. A stray newline in the x-goog-api-key header makes the request fail outright.
 */
export const cleanKey = (k: string) => k.replace(/[\s"'“”‘’]+/g, "");

export const getGeminiKey = () => cleanKey(read(KEY_STORE));
export const setGeminiKey = (k: string) => write(KEY_STORE, cleanKey(k));
/** The model typed by hand, or "" when the app should choose. */
export const getGeminiModel = () => read(MODEL_STORE).trim();
export const setGeminiModel = (m: string) => write(MODEL_STORE, m.trim());
export const aiEnabled = () => !!getGeminiKey();

const keyTag = (key: string) => key.slice(-8);
/** The model auto-picked for this key, or "". */
export const getAutoModel = (key: string = getGeminiKey()) => {
  const [tag, ...rest] = read(AUTO_STORE).split("|");
  return key && tag === keyTag(key) ? rest.join("|") : "";
};
const rememberAutoModel = (key: string, model: string) => write(AUTO_STORE, `${keyTag(key)}|${model}`);
const forgetAutoModel = () => write(AUTO_STORE, "");

// ---- Talking to Google: errors in plain English, ListModels, picking a model ------------------------------

export type AiFailure = "no-key" | "offline" | "bad-key" | "forbidden" | "bad-model" | "rate-limit" | "failed";
/** `status` is the HTTP status (absent for network errors); `message` is Google's own error text, or the network error. */
export type AiFail = { ok: false; reason: AiFailure; status?: number; message?: string };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const reasonFor = (status: number): AiFailure =>
  status === 400 || status === 401 ? "bad-key" : status === 403 ? "forbidden" : status === 404 ? "bad-model" : status === 429 ? "rate-limit" : "failed";

/** What a failure means, in plain English. */
export function explainFailure(f: Pick<AiFail, "reason" | "status">): string {
  switch (f.reason) {
    case "no-key":
      return "No key saved. Paste your Google AI Studio key first.";
    case "bad-key":
      return "The API key is invalid. Copy it again from Google AI Studio (aistudio.google.com/apikey) with nothing extra before or after it.";
    case "forbidden":
      return "The API isn't enabled for this key's project, or the key is restricted (to certain apps, websites or APIs). Make a new unrestricted key in Google AI Studio, or enable the Generative Language API for it.";
    case "bad-model":
      return "The model name is wrong or Google has retired it. Clear the model name under Advanced so a current one is picked automatically.";
    case "rate-limit":
      return "Rate limit: the free quota is used up for now. Wait a minute (or until tomorrow) and try again.";
    case "offline":
      return "Network error: couldn't reach Google. Check the phone's internet connection. If other apps are online, the app's WebView or its content-security / network settings may be blocking the request.";
    default:
      return f.status ? `Google answered with an unexpected status (${f.status}).` : "Something unexpected went wrong.";
  }
}

/** Google's error body is `{"error":{"code":400,"message":"…","status":"INVALID_ARGUMENT"}}`; fall back to the raw text. */
async function failFromResponse(res: Response): Promise<AiFail> {
  const text = await res.text().catch(() => "");
  let message = text.trim().slice(0, 300);
  try {
    const e = (JSON.parse(text) as { error?: { message?: string; status?: string } }).error;
    if (e?.message) message = e.status ? `${e.message} (${e.status})` : e.message;
  } catch {
    /* not JSON: keep the raw text */
  }
  return { ok: false, reason: reasonFor(res.status), status: res.status, message: message || res.statusText || undefined };
}

function failFromError(e: unknown): AiFail {
  const name = (e as { name?: string })?.name;
  const msg = (e as { message?: string })?.message;
  if (name === "AbortError") return { ok: false, reason: "offline", message: "Timed out waiting for Google." };
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || e instanceof TypeError) return { ok: false, reason: "offline", message: msg || "Failed to fetch" };
  return { ok: false, reason: "failed", message: msg };
}

/** fetch with a hard time limit; never throws. */
async function guarded<T>(ms: number, run: (signal: AbortSignal) => Promise<T | AiFail>): Promise<T | AiFail> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await run(ctl.signal);
  } catch (e) {
    return failFromError(e);
  } finally {
    clearTimeout(timer);
  }
}

export interface GeminiModel {
  /** "models/gemini-2.5-flash" */
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/** GET /v1beta/models?key=KEY. The result carries the exact HTTP status either way. */
export async function listModels(
  rawKey: string,
  opts: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<{ ok: true; status: number; models: GeminiModel[] } | AiFail> {
  const key = cleanKey(rawKey);
  if (!key) return { ok: false, reason: "no-key" };
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  return guarded(opts.timeoutMs ?? TEST_TIMEOUT_MS, async (signal) => {
    const res = await fetcher(`${API}/models?pageSize=1000&key=${encodeURIComponent(key)}`, { method: "GET", signal });
    if (!res.ok) return failFromResponse(res);
    const json = (await res.json().catch(() => ({}))) as { models?: GeminiModel[] };
    return { ok: true as const, status: res.status, models: json.models ?? [] };
  });
}

/** Not text models (or not for this job). */
const NOT_FOR_TEXT = /image|tts|audio|live|native|embed|robotics|computer|thinking|exp|vision|learnlm|imagen|veo|customtools/i;

/**
 * The usable Flash models from a ListModels result, best first: stable before preview, full Flash before Flash-Lite,
 * a numbered version before the "-latest" alias, then the highest version. Nothing here is a fixed model name,
 * so it keeps working as Google releases new ones and retires old ones.
 */
export function rankFlashModels(models: GeminiModel[]): string[] {
  const version = (id: string) => parseFloat(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "");
  return models
    .filter((m) => (m.supportedGenerationMethods ?? ["generateContent"]).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => /^gemini-/.test(id) && /flash/.test(id) && !NOT_FOR_TEXT.test(id))
    .map((id) => ({ id, preview: /preview/.test(id), lite: /lite/.test(id), alias: isNaN(version(id)), v: version(id) || 0 }))
    .sort(
      (a, b) =>
        Number(a.preview) - Number(b.preview) ||
        Number(a.lite) - Number(b.lite) ||
        Number(a.alias) - Number(b.alias) ||
        b.v - a.v ||
        a.id.length - b.id.length,
    )
    .map((m) => m.id);
}

// ---- What we ask for ---------------------------------------------------------------------------------

export type AiType = "session" | "task" | "event" | "bill" | "grocery" | "reminder" | "chore" | "note" | "idea";
const TYPES: AiType[] = ["session", "task", "event", "bill", "grocery", "reminder", "chore", "note", "idea"];

/** Gemini's answer. Every field is optional and validated before use. */
export interface AiIntent {
  type?: AiType;
  title?: string;
  area?: string | null;
  date?: string | null;
  time?: string | null;
  duration_min?: number | null;
  priority?: "high" | "normal" | "low" | null;
  recurrence?: string | null;
  best_slot?: string | null;
  confidence?: number;
  /** For groceries: the things to buy. */
  items?: string[] | null;
  /** For bills: true when the note says it's already paid. */
  done?: boolean | null;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: TYPES },
    title: { type: "STRING" },
    area: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    time: { type: "STRING", nullable: true },
    duration_min: { type: "INTEGER", nullable: true },
    priority: { type: "STRING", enum: ["high", "normal", "low"], nullable: true },
    recurrence: { type: "STRING", nullable: true },
    best_slot: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
    items: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
    done: { type: "BOOLEAN", nullable: true },
  },
  required: ["type", "title", "confidence"],
};

const hhmm = (min: number) => toHHMM(min);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayNames = (days: number[]) => [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAYS[(d + 6) % 7]).join(",");

/** The system prompt: who you are, how your days work, what's already planned. Kept compact. */
export function buildSystemPrompt(data: AppData, now: Date): string {
  const p = withDefaults(data.profile);
  const today = toISO(now);
  const tomorrow = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const wd = (d: ISODate) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" });

  const areas = p.areas
    .map((a) => `${a.id}=${a.name}${a.target ? ` [${a.target.perWeek}x/week, ${a.target.minutes} min${a.target.variants?.length ? `, alternates ${a.target.variants.join("/")}` : ""}]` : ""}`)
    .join("; ");
  const slots = p.slots.map((s) => `${s.id}=${s.name} ${s.start}-${s.end} ${dayNames(s.days)}`).join("; ");
  const checkins = p.rhythm.filter((r) => r.enabled).map((r) => `${r.id}=${r.label} ${r.time}${r.kind === "chore" ? " (asks until done)" : ""}`).join("; ");
  const bills = (data.bills ?? []).filter((b) => b.enabled).map((b) => `${b.id}=${b.name} (${describeSchedule(b)}${b.autopay ? ", autopay" : ""})`).join("; ");

  const day = (d: ISODate) => {
    const lines = [
      ...eventsOn(data, d).map((e) => `${e.start ?? "all day"} EVENT ${e.title}`),
      ...plannedForDay(data, d).map((s) => `${hhmm(s.start)} ${s.title}${s.done ? " (done)" : ""}`),
    ];
    return lines.length ? lines.join("; ") : "nothing";
  };

  return [
    `You are the understanding engine of ${p.name}'s personal daily planner. Read ONE short note (English, Hinglish in Roman letters, or Hindi in Devanagari) and return JSON describing what the app should do with it. Never reply with anything but JSON.`,
    `Now: ${wd(today)} ${today}, ${hhmm(now.getHours() * 60 + now.getMinutes())} local time.`,
    `Areas (use the id in "area"): ${areas}.`,
    `Work: ${dayNames(p.workDays)} ${p.workStart}-${p.workEnd} from home${p.officeDays.length ? `, office on ${dayNames(p.officeDays)}` : ""}. Sessions go in these slots: ${slots}.`,
    `Daily check-ins: ${checkins}. End-of-day check at ${p.eveningWrap}.`,
    `Bills: ${bills}.`,
    `Already planned today: ${day(today)}. Tomorrow: ${day(tomorrow)}.`,
    "",
    "Choose \"type\":",
    '- session: the user says they DID a session of one of the areas that have a weekly target ("did Power BI", "meditation kiya", "walk kar li"). "date" is when (today unless they say otherwise; with a past-tense verb, "kal" means YESTERDAY).',
    "- event: a fixed commitment at a clock time (dinner out, appointment, meeting, flight) or anything starting with the word event. Needs date and time.",
    '- grocery: things to buy or that ran out ("milk khatam", "need sugar", "out of eggs"). Put the item names in "items". Never use this for non-food shopping.',
    '- bill: about paying a bill. Set "done": true if it says it was already paid ("paid rent", "rent bhar diya").',
    '- reminder: a task tied to a specific time. chore: a household task. task: anything else to do.',
    "- note / idea: something to remember or an idea, not an action.",
    "",
    "Fields:",
    '- "title": short, in the user\'s own words and language, with date/time words and filler ("karna hai", "remind me to", "yaad dilana") removed.',
    '- "area": the best area id. If unclear use "others".',
    '- "date" (YYYY-MM-DD) and "time" (24h HH:mm): only if the note says or clearly implies them. "kal" = tomorrow (except as above), "parso" = day after tomorrow. NEVER invent a date or time: leave null.',
    '- "best_slot": only when no date or time was given, say when it fits the user\'s rhythm: "emails" (anything about email or the inbox), "work-hours", "after-work", "evening", "night", "before-work", "weekend", or "none".',
    '- "recurrence": a phrase like "every monday", "daily", "weekdays", "every 1st", else null. "duration_min": only if stated. "priority": "high" only if they say urgent or important.',
    '- "confidence": 0 to 1, how sure you are. Use below 0.6 when the note is ambiguous.',
  ].join("\n");
}

/** One generateContent call against a specific model. */
async function generateOnce(key: string, model: string, req: { system?: string; user: string }, fetcher: Fetcher, ms: number): Promise<{ ok: true; result: AiIntent } | AiFail> {
  return guarded(ms, async (signal) => {
    const res = await fetcher(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          // Reading a note doesn't need deep reasoning; this keeps it quick (only some models accept it).
          ...(model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });
    if (!res.ok) return failFromResponse(res);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false as const, reason: "failed" as const, status: res.status, message: "Google's reply wasn't the JSON that was asked for." };
    }
    if (!parsed || typeof parsed !== "object") return { ok: false as const, reason: "failed" as const, status: res.status, message: "Google's reply was empty." };
    return { ok: true as const, result: parsed as AiIntent };
  });
}

/**
 * Calls Gemini. Resolves to the parsed JSON, or why it didn't work (with the HTTP status and Google's message). Never throws.
 * The model is the one typed under Advanced if any, else the one auto-picked from ListModels (picked now if needed,
 * and picked again if Google says it no longer exists).
 */
export async function callGemini(
  req: { system?: string; user: string },
  opts: { key?: string; model?: string; fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<{ ok: true; result: AiIntent; model: string } | AiFail> {
  const key = cleanKey(opts.key ?? getGeminiKey());
  if (!key) return { ok: false, reason: "no-key" };
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const started = Date.now();
  const budget = opts.timeoutMs ?? TIMEOUT_MS;
  const left = () => budget - (Date.now() - started);

  const pinned = (opts.model ?? getGeminiModel()).trim();
  let model = pinned || getAutoModel(key);
  let last: AiFail = { ok: false, reason: "failed" };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (left() <= 250) return { ok: false, reason: "offline", message: "Timed out waiting for Google." };
    if (!model) {
      const l = await listModels(key, { fetcher, timeoutMs: left() });
      if (!l.ok) return l;
      model = rankFlashModels(l.models)[0] ?? "";
      if (!model) return { ok: false, reason: "bad-model", status: l.status, message: "Google listed no Flash model that supports generateContent for this key." };
      rememberAutoModel(key, model);
      if (left() <= 250) return { ok: false, reason: "offline", message: "Timed out waiting for Google." };
    }
    const r = await generateOnce(key, model, req, fetcher, left());
    if (r.ok) return { ...r, model };
    last = r;
    // The remembered model has been retired: forget it and pick again from Google's current list.
    if (r.reason === "bad-model" && !pinned && attempt === 0) {
      forgetAutoModel();
      model = "";
      continue;
    }
    return r;
  }
  return last;
}

/** What "Test key" shows on screen. `lines` are plain text, one per line. */
export interface KeyTestReport {
  ok: boolean;
  /** The model chosen (and remembered) when the test worked. */
  model?: string;
  lines: string[];
}

const statusLine = (f: AiFail) =>
  f.status ? `HTTP ${f.status}${f.message ? `: ${f.message}` : ""}` : `No response from Google${f.message ? `: ${f.message}` : ""}`;

/**
 * Settings → "Test key". Step 1 is Google's ListModels (so a bad key, a disabled API or a blocked network shows up with the
 * exact status and message), step 2 picks the best current Flash model from that list, step 3 reads one sample note with it.
 * A typed model name under Advanced is used instead of the pick. The working model is remembered for this key.
 */
export async function testGeminiKey(rawKey: string, opts: { model?: string; fetcher?: Fetcher; timeoutMs?: number } = {}): Promise<KeyTestReport> {
  const key = cleanKey(rawKey);
  if (!key) return { ok: false, lines: ["✗ " + explainFailure({ reason: "no-key" })] };
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? TEST_TIMEOUT_MS;

  const l = await listModels(key, { fetcher, timeoutMs });
  if (!l.ok) return { ok: false, lines: [`✗ ListModels failed. ${statusLine(l)}`, `What it means: ${explainFailure(l)}`] };

  const lines = [`✓ ListModels: HTTP ${l.status}, ${l.models.length} models available`];
  const pinned = (opts.model ?? "").trim();
  const candidates = pinned ? [pinned] : rankFlashModels(l.models).slice(0, 3);
  if (!candidates.length) {
    return { ok: false, lines: [...lines, "✗ No Flash model that supports generateContent was listed for this key.", `What it means: ${explainFailure({ reason: "bad-model" })}`] };
  }

  let failure: AiFail = { ok: false, reason: "failed" };
  let tried = "";
  for (const model of candidates) {
    tried = model;
    const r = await callGemini({ user: 'Note: "kal 6 baje mummy ko call karna hai"' }, { key, model, fetcher, timeoutMs });
    if (r.ok) {
      if (!pinned) rememberAutoModel(key, model);
      const x = r.result;
      return {
        ok: true,
        model,
        lines: [
          ...lines,
          `✓ Model ${pinned ? "(typed by you)" : "chosen automatically"}: ${model}`,
          `✓ Test read: ${x.type ?? "task"}, “${x.title ?? ""}”${x.date ? `, ${x.date}` : ""}${x.time ? ` ${x.time}` : ""}`,
        ],
      };
    }
    failure = r;
    // Only a model-specific problem (not found, or no free quota on that one) is worth trying the next model for.
    if (r.reason !== "bad-model" && r.reason !== "rate-limit") break;
  }
  return { ok: false, lines: [...lines, `✗ The test note failed on ${tried}. ${statusLine(failure)}`, `What it means: ${explainFailure(failure)}`] };
}

// ---- Turning Gemini's answer into something the app can act on -----------------------------------------

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MIN_CONFIDENCE = 0.55;

/** Minutes → "HH:mm", for an end time from a start plus a duration. */
function plus(start: string, min: number) {
  const t = toMin(start) + min;
  return t >= 1440 ? undefined : hhmm(t);
}

/**
 * Validates Gemini's answer against the rules' answer and your data. Returns null if it isn't trustworthy,
 * in which case the caller keeps the rules' answer. A date or time the rules found in the text always wins.
 */
export function fromAi(ai: AiIntent, rules: ParsedCapture, text: string, data: AppData, now: Date): ParsedCapture | null {
  if (!ai || !TYPES.includes(ai.type as AiType)) return null;
  const conf = typeof ai.confidence === "number" ? ai.confidence : 0.7;
  if (conf < MIN_CONFIDENCE) return null;

  const p = withDefaults(data.profile);
  const today = toISO(now);
  const lo = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2));
  const hi = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 400));
  const dateOk = (d: unknown): d is string => isDate(d) && d >= lo && d <= hi;
  const areaOk = (a: unknown): a is string => typeof a === "string" && p.areas.some((x) => x.id === a);
  const base: ParsedCapture = { ...rules, tags: [...rules.tags], source: "ai" };

  switch (ai.type) {
    case "session": {
      // Only believe a finished session if the words say "done" (or the rules already saw it).
      if (rules.kind !== "session" && !(looksPast(text) && conf >= 0.8)) return null;
      const area = areaOk(ai.area) && p.areas.find((a) => a.id === ai.area)?.target ? ai.area : rules.session?.areaId;
      if (!area) return null;
      const a = p.areas.find((x) => x.id === area)!;
      const date = rules.session?.date ?? (dateOk(ai.date) && ai.date <= today ? ai.date : today);
      return { ...base, kind: "session", session: { areaId: area, date }, title: a.name, area, areaSource: "ai" };
    }
    case "grocery": {
      const items = (ai.items ?? []).map((s) => String(s).trim()).filter((s) => s && s.length <= 60).map(cap);
      if (!items.length) return null;
      return { ...base, kind: "grocery", groceryItems: [...new Set(items)], title: items.join(", "), area: undefined };
    }
    case "bill": {
      const bill = matchBill(text, data.bills ?? []);
      if (ai.done && bill) return { ...base, kind: "paid", paidBillId: bill.id, title: bill.name, area: "finance", areaSource: "ai" };
      break; // an unpaid bill is a finance task, handled below
    }
    case "note":
    case "idea": {
      const title = ai.title?.trim() || rules.title;
      return { ...base, kind: "note", title: cap(title.slice(0, 200)), area: p.areas.some((a) => a.id === "notes") ? "notes" : undefined, areaSource: "ai", due: undefined, dueTime: undefined };
    }
    default:
      break;
  }

  // ---- task / reminder / chore / event / unpaid bill ----
  const out: ParsedCapture = { ...base };

  // A day or time the offline picker SUGGESTED isn't something you typed: Gemini may do better. Start clean.
  const guessed = !!rules.slotReason;
  if (guessed) {
    out.due = undefined;
    out.dueTime = undefined;
    out.timeSource = undefined;
    out.slotReason = undefined;
  }
  const typedDue = guessed ? undefined : rules.due;
  const typedTime = guessed ? undefined : rules.dueTime;

  // Title: Gemini's tidier version, if it's sane (still about the same thing, and not a rewrite).
  const t = ai.title?.trim();
  if (t && t.length <= 100) {
    const mine = new Set(significantWords(text));
    const overlap = significantWords(t).filter((w) => mine.has(w) || [...mine].some((m) => m.slice(0, 5) === w.slice(0, 5))).length;
    if (overlap >= 1 || mine.size === 0) out.title = cap(t);
  }

  // Area: Gemini's reading beats a dictionary guess, but never something you typed (@area).
  if (rules.areaSource !== "explicit" && areaOk(ai.area)) {
    out.area = ai.area;
    out.areaSource = "ai";
  }

  // Date / time: what the rules found in the text wins; Gemini fills the gaps.
  if (!typedDue && dateOk(ai.date)) {
    out.due = ai.date;
    if (!typedTime && isTime(ai.time)) {
      out.dueTime = ai.time;
      out.timeSource = "ai";
    }
  } else if (typedDue && !typedTime && isTime(ai.time)) {
    out.dueTime = ai.time;
    out.timeSource = "ai";
  }

  const mins = typeof ai.duration_min === "number" && ai.duration_min >= 5 && ai.duration_min <= 480 ? Math.round(ai.duration_min) : undefined;
  if (mins && !rules.estimateMin) out.estimateMin = mins;
  if (ai.priority === "high") out.important = true;

  // Repeats: reuse the rules' recurrence reader on Gemini's phrase.
  if (!rules.recur && typeof ai.recurrence === "string" && ai.recurrence.trim()) {
    const r = extractRecurrence(ai.recurrence).recur;
    if (r) {
      out.recur = r;
      out.due = firstOccurrence(r, today);
    }
  }

  // A fixed commitment: needs a real day and time.
  if (ai.type === "event" && out.due && out.dueTime) {
    const end = rules.dueEndTime ?? (mins ? plus(out.dueTime, mins) : undefined);
    return { ...out, kind: "event", event: { start: out.dueTime, end, countsFor: inferCountsFor(out.title, p.areas) } };
  }
  out.kind = out.kind === "event" ? "event" : "task";

  // No day given: Gemini's hint about where it fits the rhythm, else the offline picker (in finalize).
  if (!out.due && typeof ai.best_slot === "string") out.slotHint = ai.best_slot;
  return out;
}

export type SmartResult = { parsed: ParsedCapture; used: "ai" | "rules"; reason?: AiFailure };

/**
 * Rules first (instant, offline). If a key is set, Gemini gets the final say when it's confident;
 * otherwise, or on any problem, the rules' answer stands. Always resolves with something usable.
 */
export async function interpret(
  text: string,
  rules: ParsedCapture,
  data: AppData,
  now: Date,
  opts: { fetcher?: Fetcher; key?: string; model?: string; timeoutMs?: number } = {},
): Promise<SmartResult> {
  if (!(opts.key ?? getGeminiKey())) return { parsed: rules, used: "rules" };
  try {
    const r = await callGemini({ system: buildSystemPrompt(data, now), user: `Note: ${JSON.stringify(text)}` }, opts);
    if (!r.ok) return { parsed: rules, used: "rules", reason: r.reason };
    const built = fromAi(r.result, rules, text, data, now);
    if (!built) return { parsed: rules, used: "rules" };
    return { parsed: finalize(built, data, now), used: "ai" };
  } catch {
    return { parsed: rules, used: "rules", reason: "failed" };
  }
}
