import type { ISODate } from "./types";

/**
 * Email → event, read on the phone. Text shared from Gmail is parsed here, offline and private: a date like "Tue, 3 Nov 2026",
 * a time range like "(07:00-10:00 GMT)", a status, and a title from the booking line. Nothing leaves the phone, and nothing is
 * saved from this: the result only fills the confirm sheet.
 *
 *   Pinnacle Event Staff … Approved … Tue, 3 Nov 2026 (07:00-10:00 GMT) · PE898 World Traveller Market Exhibition, Standby
 *   →  "WTM Exhibition shift (Pinnacle) — Standby", Tue 3 Nov 2026, 07:00–10:00, Side work, Approved
 */
export interface ParsedShare {
  title: string;
  date: ISODate;
  /** "HH:mm". Omitted when the text names a day but no time. */
  start?: string;
  end?: string;
  /** "Approved", "Confirmed", "Pending"… as the email said it. */
  status?: string;
  /** Area id: "sidework" for staffing / shift bookings. */
  area?: string;
  /** Read on the phone, or by Gemini (only when the phone found no date). */
  source: "local" | "gemini";
  /** The text looked like a shift (so the lead-up reminders are set). */
  shift: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WD = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
const pad = (n: number) => String(n).padStart(2, "0");
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
};

/** The first date in the text: "Tue, 3 Nov 2026", "3rd November 2026", "Nov 3, 2026", "03/11/2026" (UK order), "2026-11-03". */
export function findDate(text: string, now: Date): { date: ISODate; index: number; length: number } | null {
  const tries: Array<[RegExp, (m: RegExpExecArray) => ISODate | null]> = [
    [new RegExp(`(?:${WD},?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})\\.?,?\\s+(\\d{4})`, "i"), (m) => (valid(+m[3], monthOf(m[2]), +m[1]) ? iso(+m[3], monthOf(m[2]), +m[1]) : null)],
    [new RegExp(`(?:${WD},?\\s+)?(${MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i"), (m) => (valid(+m[3], monthOf(m[1]), +m[2]) ? iso(+m[3], monthOf(m[1]), +m[2]) : null)],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => (valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null)],
    [/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/, (m) => (valid(+m[3], +m[2], +m[1]) ? iso(+m[3], +m[2], +m[1]) : null)],
    // No year ("Tue, 3 Nov"): the next one that comes round.
    [
      new RegExp(`(?:${WD},?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})\\b`, "i"),
      (m) => {
        const mo = monthOf(m[2]);
        let y = now.getFullYear();
        if (!valid(y, mo, +m[1])) return null;
        if (new Date(y, mo - 1, +m[1]) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y++;
        return iso(y, mo, +m[1]);
      },
    ],
  ];
  for (const [re, make] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const date = make(m);
    if (date) return { date, index: m.index, length: m[0].length };
  }
  return null;
}

/** London's offset from UTC on a day, in minutes (0 in winter, 60 in summer). */
function londonOffset(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return -new Date(y, m - 1, d, 12).getTimezoneOffset();
}

const toHM = (min: number) => `${pad(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad((((min % 60) + 60) % 60))}`;

/** A time range ("07:00-10:00", "7am to 10am", "07.00–10.00 GMT") in London time, or a single time. */
export function findTimes(text: string, date: ISODate): { start: string; end?: string; index: number; length: number } | null {
  const T = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?`;
  const range = new RegExp(`${T}\\s*(?:-|–|—|to|until|till)\\s*${T}(?:\\s*\\(?\\s*(GMT|BST|UTC)\\)?)?`, "i").exec(text);
  const single = new RegExp(`\\b(?:at|from|@)\\s+${T}(?:\\s*\\(?\\s*(GMT|BST|UTC)\\)?)?`, "i").exec(text);
  const clock = (h: string, mi: string | undefined, ap: string | undefined) => {
    let hh = +h;
    if (ap) hh = (hh % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
    return hh * 60 + (mi ? +mi : 0);
  };
  // A bare "3 Nov" or "2026" is not a time: a range needs a colon / dot / am / pm on at least one side.
  const looksTimed = (m: RegExpExecArray | null) => !!m && /[:.]\d{2}|am|pm/i.test(m[0]);
  const shift = (tz: string | undefined) => {
    const off = londonOffset(date);
    // "GMT"/"UTC" is the time in London's winter; in summer London is an hour ahead. "BST" is already London summer time.
    if (!tz) return 0;
    const z = tz.toUpperCase();
    return z === "BST" ? off - 60 : off;
  };
  if (range && looksTimed(range)) {
    const s = clock(range[1], range[2], range[3]);
    let e = clock(range[4], range[5], range[6]);
    // "7-10pm": the am/pm on the end belongs to both.
    const sAp = range[3] ?? undefined;
    const eAp = range[6] ?? undefined;
    let start = s;
    if (!sAp && eAp && /pm/i.test(eAp) && +range[1] < 12 && s < e - 12 * 60 + 1440) start = clock(range[1], range[2], eAp);
    if (e <= start) e += 0;
    const d = shift(range[7]);
    return { start: toHM(start + d), end: e > start ? toHM(e + d) : undefined, index: range.index, length: range[0].length };
  }
  if (single && looksTimed(single)) {
    const d = shift(single[4]);
    return { start: toHM(clock(single[1], single[2], single[3]) + d), index: single.index, length: single[0].length };
  }
  return null;
}

const STATUS = /\b(approved|confirmed|standby|stand-by|pending|provisional|accepted|offered|declined|cancelled|canceled|rejected|waitlisted)\b/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const STAFFING = /\b(staff|staffing|shift|standby|stand-by|casual|agency|temp|recruitment|steward|crew|hospitality|event staff|rota)\b/i;
const GENERIC_END = /^(exhibition|conference|show|expo|festival|summit|fair|convention|event|market|congress|forum)$/i;
const ORG_SUFFIX = /^(event|events|staff|staffing|agency|recruitment|ltd|limited|group|services|solutions|temps|casual|hospitality|plc|uk)$/i;

/** "World Traveller Market Exhibition" → "WTM Exhibition". Short names are left as they are. */
function shorten(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 4 && GENERIC_END.test(words[words.length - 1])) {
    const lead = words.slice(0, -1);
    return `${lead.map((w) => w[0].toUpperCase()).join("")} ${words[words.length - 1]}`;
  }
  return name;
}

/** "Pinnacle Event Staff" → "Pinnacle". */
function shortOrg(org: string): string {
  const words = org.split(/\s+/).filter(Boolean);
  while (words.length > 1 && ORG_SUFFIX.test(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** The organisation: the first words of the text, up to an ellipsis, a dash or a line break. */
function findOrg(text: string): string | undefined {
  const first = text.trim().split(/\n/)[0].split(/[…]|\.{3}|\s[-–—|·•]\s/)[0].trim();
  if (!first || first.length > 50 || /\d/.test(first)) return undefined;
  const words = first.split(/\s+/);
  return words.length <= 5 && words.every((w) => /^[A-Z&(]/.test(w) || /^(of|and|the)$/i.test(w)) ? first : undefined;
}

/**
 * Reads shared text. Returns null when it finds no date (the caller may then ask Gemini, if a key is set, or fall back to ordinary
 * capture). A date without a time is still an event: the confirm sheet asks for the time.
 */
export function parseShared(raw: string, now: Date = new Date()): ParsedShare | null {
  const text = raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!text) return null;
  const found = findDate(text, now);
  if (!found) return null;
  const after = text.slice(found.index + found.length);
  const near = findTimes(after.slice(0, 80), found.date);
  const times = near ?? findTimes(text, found.date);
  // Where the date (and a time right after it) ends: the booking line comes next.
  const rest = near ? after.slice(near.index + near.length) : after;

  const before = text.slice(0, found.index);
  const status = STATUS.exec(before)?.[1] ?? STATUS.exec(text)?.[1];

  // The booking line is what comes after the date and time, past a separator: "· PE898 World Traveller Market Exhibition, Standby".
  // It counts as a booking line only after a separator ("· PE898 World Traveller Market Exhibition, Standby").
  const line = (/^[\s)\]]*[·•|–—:-]\s*([^\n]+)/.exec(rest)?.[1] ?? "").trim();
  const noCode = line.replace(/^[A-Z]{1,4}\d{2,6}\s+/, "").trim();
  const comma = noCode.lastIndexOf(",");
  const roleCandidate = comma >= 0 ? noCode.slice(comma + 1).trim() : "";
  const role = roleCandidate && roleCandidate.split(/\s+/).length <= 3 ? cap(roleCandidate) : "";
  const name = (role ? noCode.slice(0, comma) : noCode).trim().replace(/[.,;]+$/, "");

  const org = findOrg(text);
  const shift = STAFFING.test(text);
  const small = name ? shorten(name) : "";
  let title: string;
  if (small) {
    const base = shift && !/\bshift\b/i.test(small) ? `${small} shift` : small;
    title = `${base}${shift && org ? ` (${shortOrg(org)})` : ""}${role ? ` — ${role}` : ""}`;
  } else {
    // No booking line: the first line that is not just a date or an organisation.
    const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l && !findDate(l, now)) ?? "";
    title = (firstLine || org || "Event").replace(/[…]+/g, "").slice(0, 70).trim();
  }

  return { title, date: found.date, start: times?.start, end: times?.end, status: status ? cap(status.replace("stand-by", "standby")) : undefined, area: shift ? "sidework" : undefined, source: "local", shift };
}

/** Text that is long enough, and has enough detail, to be worth asking Gemini about when the phone could not find a date. */
export function looksLikeBooking(text: string): boolean {
  const t = text.trim();
  return t.length >= 60 && !/^https?:\/\/\S+$/.test(t) && /\d/.test(t);
}
