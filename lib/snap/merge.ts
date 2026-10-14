import { addDays, fromISO, isISO, toISO } from "../dates";
import { FIELDS, SNAP_TYPES, type FieldName, type SnapItem, type SnapType } from "./types";

/**
 * Takes Gemini's answer and the offline reading and makes one list. Every Gemini field is checked first (a real date, a sane
 * time, an amount that is a number); one that fails is ignored, and a whole answer that is garbage changes nothing. A Gemini
 * field replaces an offline one only when it is valid AND more confident. A day or time the two read differently is NEVER
 * swapped quietly: the offline value stays and the item is flagged "check date" with what Gemini read.
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_CONF = 0.6;
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= max * 2 ? t.slice(0, max) : undefined;
};

/** One answer item checked field by field. Returns null when nothing in it can be used. */
export function validateItem(raw: unknown, now: Date): SnapItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!SNAP_TYPES.includes(r.type as SnapType)) return null;
  const title = clean(r.title, 100);
  if (!title || letters(title) < 3) return null;
  const lo = addDays(toISO(now), -400);
  const hi = addDays(toISO(now), 800);
  // A real calendar day: "2026-13-45" must not pass just because a Date can roll it over into 2027.
  const day = (v: unknown) => (typeof v === "string" && isISO(v) && toISO(fromISO(v)) === v && v >= lo && v <= hi ? v : undefined);
  const time = (v: unknown) => (typeof v === "string" && TIME.test(v) ? v : undefined);
  const c = r.conf && typeof r.conf === "object" ? (r.conf as Record<string, unknown>) : {};
  const confOf = (f: FieldName) => {
    const n = c[f];
    return typeof n === "number" && isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_CONF;
  };

  const item: SnapItem = { type: r.type as SnapType, title, conf: { title: confOf("title") }, via: "gemini" };
  const date = day(r.date);
  if (date) {
    item.date = date;
    item.conf.date = confOf("date");
  }
  const dueDate = day(r.dueDate);
  if (dueDate) {
    item.dueDate = dueDate;
    item.conf.dueDate = confOf("dueDate");
  }
  const start = time(r.start);
  if (start) {
    item.start = start;
    item.conf.start = confOf("start");
    const end = time(r.end);
    if (end && minOf(end) > minOf(start)) {
      item.end = end;
      item.conf.end = confOf("end");
    }
  }
  const amount = typeof r.amount === "number" && isFinite(r.amount) && r.amount > 0 && r.amount < 1_000_000 ? Math.round(r.amount * 100) / 100 : undefined;
  if (amount !== undefined) {
    item.amount = amount;
    item.conf.amount = confOf("amount");
  }
  const location = clean(r.location, 100);
  if (location) {
    item.location = location;
    item.conf.location = confOf("location");
  }
  const reference = clean(r.reference, 40);
  if (reference && /\d/.test(reference) && !/\s/.test(reference)) {
    item.reference = reference.toUpperCase();
    item.conf.reference = confOf("reference");
  }
  const source = clean(r.source, 40);
  if (source) item.source = source;
  const notes = clean(r.notes, 200);
  if (notes) item.notes = notes;
  // An entry with no day, no deadline and no amount is not something to put in a planner.
  return item.date || item.dueDate || item.amount !== undefined ? item : null;
}

/** The items of a raw answer ({ items: [...] }), valid ones only. Anything else gives []. */
export function validateGemini(raw: unknown, now: Date): SnapItem[] {
  try {
    if (!raw || typeof raw !== "object") return [];
    const list = (raw as { items?: unknown }).items;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).map((x) => validateItem(x, now)).filter((x): x is SnapItem => !!x);
  } catch {
    // Whatever shape it came in, a bad answer is just no answer.
    return [];
  }
}

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
function overlap(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const DATELIKE: FieldName[] = ["date", "start", "end", "dueDate"];

/** Merges one pair. `offline` is not changed. */
function mergePair(offline: SnapItem, gem: SnapItem, today: string): SnapItem {
  const out: SnapItem = { ...offline, conf: { ...offline.conf } };
  let used = false;
  const alt: NonNullable<SnapItem["alt"]> = {};
  for (const f of FIELDS) {
    const o = offline[f];
    const g = gem[f];
    if (g === undefined) continue;
    const oc = offline.conf[f] ?? 0;
    const gc = gem.conf[f] ?? DEFAULT_CONF;
    if (o === undefined) {
      (out as unknown as Record<string, unknown>)[f] = g;
      out.conf[f] = gc;
      used = true;
    } else if (o === g) {
      out.conf[f] = Math.max(oc, gc);
      used = true;
    } else if ((DATELIKE as string[]).includes(f)) {
      // Never swapped quietly: the phone's reading stays, flagged, with what Gemini read.
      (alt as Record<string, unknown>)[f] = g;
      out.checkDate = true;
      used = true;
    } else if (gc > oc) {
      (out as unknown as Record<string, unknown>)[f] = g;
      out.conf[f] = gc;
      used = true;
    }
  }
  if (!offline.source && gem.source) {
    out.source = gem.source;
    used = true;
  }
  if (gem.notes && !offline.notes) {
    out.notes = gem.notes;
    used = true;
  }
  // A plain "plan" or "note" becomes the more specific kind Gemini saw.
  if (gem.type !== offline.type && (offline.type === "plan" || offline.type === "note")) {
    out.type = gem.type;
    used = true;
  }
  if (Object.keys(alt).length) out.alt = alt;
  if (out.date && out.date < today && out.type !== "bill") out.checkDate = true;
  out.via = used ? "both" : (offline.via ?? "phone");
  return out;
}

/**
 * The offline items, each improved by its match in Gemini's answer (same order, same length), then any items only Gemini found
 * (only when the phone found nothing, or Gemini is very sure of them).
 */
export function mergeItems(offline: SnapItem[], raw: unknown, now: Date): { items: SnapItem[]; changed: boolean } {
  const gem = validateGemini(raw, now);
  if (!gem.length) return { items: offline, changed: false };
  const today = toISO(now);
  const left = [...gem];
  const merged: SnapItem[] = offline.map((o) => {
    let best = -1;
    let bestScore = 0;
    left.forEach((g, i) => {
      const score = (o.date && g.date && o.date === g.date ? 1 : 0) + overlap(o.title, g.title);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    // The same item is on the same day, or has most of its words in common. Anything else is a different item.
    if (best < 0 || bestScore < 0.5) return o;
    const [g] = left.splice(best, 1);
    return mergePair(o, g, today);
  });
  const extras = left.filter((g) => !offline.length || ((g.conf.date ?? 0) >= 0.8 && (g.conf.title ?? 0) >= 0.8));
  const items = [...merged, ...extras.slice(0, 8)];
  return { items, changed: items.some((it, i) => it !== offline[i]) };
}
