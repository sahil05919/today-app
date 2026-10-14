import * as chrono from "chrono-node";
import { toISO } from "../dates";
import { normalizeHinglish } from "../hinglish";
import { parseCapture } from "../parse";
import { withDefaults } from "../profile";
import { parseShared } from "../shareParse";
import { promoteEvent } from "../understand";
import type { ISODate, Profile } from "../types";
import { cleanPage, type CleanLine, type CleanPage } from "./clean";
import { findSensitive, maskSensitive } from "./sensitive";
import { TYPE_LABEL, type FieldName, type OcrPage, type SnapItem, type SnapReading, type SnapType } from "./types";

/**
 * Step D: the offline brain. Cleaned text in, items out, with a confidence for every field. It runs on the phone with no network
 * and has to be good on its own: Gemini (lib/snap/gemini.ts) only ever improves on what is read here.
 *
 *   classify the document → find dates and times with chrono's en.GB (so 03/11/2026 is 3 November) → give each one a role from the
 *   words in front of it (due / starts / doors / ends / issued…) → pick title, place, amount, reference → one or several items.
 *
 * Chat-style text ("party sat 8pm at mine", "kal 5 baje call karna") is not a document: it goes through the app's own capture
 * parser (lib/parse.ts, with the Hinglish rules), exactly as if it had been typed.
 */
export interface ExtractCtx {
  /** The day "tomorrow" and "this Sat" are counted from: the picture's own date when known, else today. */
  ref: Date;
  /** The real now: a day already past is flagged. */
  now: Date;
  profile?: Profile;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---- What kind of document -------------------------------------------------------------------------------------------------

interface Rule {
  type: SnapType;
  strong: RegExp;
  weak: RegExp;
}

const RULES: Rule[] = [
  {
    type: "bill",
    strong: /\b(?:due (?:on |by )?(?:\d{1,2}(?:st|nd|rd|th)?\b|(?:mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)|amount (?:due|to pay|owed)|total (?:due|to pay|amount due)|balance (?:due|to pay)|payment due|pay(?:ment)? by|please pay|minimum payment|statement (?:date|balance)|new balance|invoice(?: (?:no|number|date))?|council tax|direct debit|your (?:energy |gas |electricity |water |broadband )?bill|bill date|due date)\b/gi,
    weak: /\b(?:statement|account number|account no|tariff|kwh|meter|standing charge|energy|electricity|gas|water|broadband|balance|instalment|installment|credit card|barclaycard|capital one|mbna|vat|billing)\b/gi,
  },
  {
    type: "delivery",
    strong: /\b(?:parcel|out for delivery|we missed you|sorry we missed|redelivery|re-delivery|delivery (?:date|day|attempt|window)|your (?:package|parcel|delivery)|tracking (?:number|no|id)|consignment|delivered|will (?:arrive|be delivered)|arriving (?:today|tomorrow|on)|dispatched|delivery office)\b/gi,
    weak: /\b(?:royal mail|amazon|dpd|evri|hermes|yodel|dhl|ups|fedex|courier|driver|post office|signature|safe place|delivery)\b/gi,
  },
  {
    type: "appointment",
    strong: /\b(?:appointment|appt|outpatient|clinic|please attend|please arrive|surgery|check-?up|consultation|vaccination|screening|physio(?:therapy)?|optician|eye test|blood test|nhs|interview)\b/gi,
    weak: /\b(?:dr\.?|doctor|dentist|dental|gp|hospital|nurse|patient|rebook|reschedule|reply [cy] to confirm|arrive \d+ min)\b/gi,
  },
  {
    type: "shift",
    strong: /\b(?:shifts?|rota|standby|stand-by|timesheet|unitemps|talent bank|king['’]?s talent|pinnacle|hourly rate|per hour|\/hr|p\/h|casual work|temp(?:orary)? (?:work|assignment|role)|assignment|vacancy|on-?call|event staff|steward|brand ambassador|student ambassador)\b/gi,
    weak: /\b(?:apply|agency|booking|approved|confirmed|offer|site|uniform|briefing|supervisor|worker|staff|staffing)\b/gi,
  },
  {
    type: "event",
    strong: /\b(?:tickets?|admit(?: one| \d)?|doors(?: open)?|gig|concert|festival|eventbrite|ticketmaster|dice(?:\.fm)?|see tickets|general admission|barcode|seats?|screen \d|row [a-z0-9]+|block \d+|venue|line-?up|rsvp|theatre|cinema|kick-?off|fixture|reservations?|order confirmation for|you(?:'|’)re going to|date and time)\b/gi,
    weak: /\b(?:event|show|live|party|night|entry|odeon|vue|cineworld|everyman|booking confirm\w*|organiser|organizer|presents|headline|admission|gate|arena|stadium|club|tour|exhibition|market|workshop|webinar|meetup|starts?)\b/gi,
  },
  {
    type: "deadline",
    strong: /\b(?:deadline|final (?:notice|reminder|demand)|reminder letter|overdue|respond by|reply by|submit(?:ted)? by|must be (?:received|returned|paid|completed) by|renew(?:al)? (?:by|before)|expires?(?: on)?|expiry date|no later than|last date|closing date|return (?:this form )?by|failure to)\b/gi,
    weak: /\b(?:hmrc|dvla|council|tribunal|court|jury|tax return|licence|license|letter|dear|sincerely|yours (?:faithfully|sincerely)|please (?:return|respond|reply|complete|confirm))\b/gi,
  },
];

const PRIORITY: SnapType[] = ["bill", "delivery", "appointment", "shift", "event", "deadline"];

const countDistinct = (text: string, re: RegExp) => new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase())).size;

/** The kind of document, or null when no kind is clear (then it is a chat message, or a note). */
export function classify(text: string): { type: SnapType; score: number } | null {
  let best: { type: SnapType; score: number } | null = null;
  for (const r of RULES) {
    const score = Math.min(2, countDistinct(text, r.strong)) * 3 + Math.min(3, countDistinct(text, r.weak));
    if (score < 3) continue;
    if (!best || score > best.score || (score === best.score && PRIORITY.indexOf(r.type) < PRIORITY.indexOf(best.type))) best = { type: r.type, score };
  }
  return best;
}

// ---- Roles of dates and times --------------------------------------------------------------------------------------------

type Role = "ignore" | "due" | "doors" | "end" | "start" | "plain";

const ROLE_WORDS: Array<[Role, string]> = [
  [
    "ignore",
    String.raw`(?:issued?(?:\s+date)?|issue\s+date|date\s+of\s+issue|printed(?:\s+on)?|print\s+date|date\s+printed|statement\s+(?:date|period)|billing\s+period|bill\s+date|invoice\s+date|date\s+of\s+invoice|tax\s+point|order(?:ed)?\s+(?:placed|date|on)|placed\s+on|purchased(?:\s+on)?|booked\s+on|booking\s+date|date\s+booked|date\s+of\s+(?:letter|birth)|letter\s+date|dated|dob|born|sent(?:\s+on)?|date\s+sent|posted(?:\s+on)?|received\s+on|created(?:\s+on)?|generated(?:\s+on)?|last\s+(?:payment|updated|login)|payment\s+received|transaction\s+date|opened|valid\s+from|member\s+since|dispatched\s+on|copyright|updated)`,
  ],
  [
    "due",
    String.raw`(?:(?:payment\s+)?due(?:\s+date)?|pay(?:ment)?(?:\s+due)?\s+(?:by|before|on)|pay\s+by|\bby|before|deadline|respond\s+by|reply\s+by|submit(?:ted)?\s+by|apply\s+by|applications?\s+close|closes?|return(?:ed)?\s+by|received\s+by|no\s+later\s+than|renew(?:al)?\s+by|expires?|expiry(?:\s+date)?|last\s+date|collect(?:ion)?\s+by|collect\s+before|held\s+until|keep\s+until|valid\s+(?:until|to)|by\s+(?:the\s+)?end\s+of|direct\s+debit(?:\s+will\s+be)?\s+(?:taken|collected)|will\s+be\s+(?:taken|collected|debited)|final\s+date|cancel\s+by)`,
  ],
  ["doors", String.raw`(?:doors?(?:\s+open)?|gates?(?:\s+open)?|arrive|check-?in|admission|entry|entrance|opens?|opening|get\s+in)`],
  ["end", String.raw`(?:ends?|until|till|finish(?:es)?|closing\s+time|curfew|carriages|home\s+by)`],
  [
    "start",
    String.raw`(?:start(?:s|ing)?(?:\s+time)?|begins?|kick-?off|show(?:\s*time)?|curtain|performance|event\s+date|date(?:\s*(?:and|&)\s*time)?|time|when|on|at|appointment(?:\s+(?:is|date|time))?|scheduled(?:\s+for)?|shift|delivery(?:\s+(?:date|day))?|redelivery(?:\s+date)?|arriv(?:es?|ing|al)|expected|your\s+appointment|from)`,
  ],
];
const JOIN = String.raw`(?:\s+(?:on|at|by|is|will\s+be|the|from|date|time))*\s*[:\-–—·|,(]*\s*$`;
const ANCHORED = ROLE_WORDS.map(([role, w]) => [role, new RegExp(`(?:^|[^a-z])${w}${JOIN}`, "i")] as const);
const FLOATING = ROLE_WORDS.map(([role, w]) => [role, new RegExp(`(?:^|[^a-z])${w}(?![a-z])`, "gi")] as const);

/** What the words in front of a date or time say it is. */
export function roleOf(label: string): Role {
  const l = label.replace(/\s+/g, " ").trim();
  if (!l) return "plain";
  for (const [role, re] of ANCHORED) if (re.test(l)) return role;
  // The role word is not right in front of it: the last one in the label wins; at the same spot ignore beats due beats the rest.
  let best: { role: Role; end: number; rank: number } | null = null;
  ROLE_WORDS.forEach(([role], rank) => {
    const re = FLOATING[rank][1];
    re.lastIndex = 0;
    for (const m of l.matchAll(re)) {
      const end = m.index! + m[0].length;
      if (!best || end > best.end || (end === best.end && rank < best.rank)) best = { role, end, rank };
    }
  });
  return (best as { role: Role } | null)?.role ?? "plain";
}

// ---- Finding dates and times ----------------------------------------------------------------------------------------------

interface Cand {
  line: number;
  /** Offset inside its line. */
  at: number;
  text: string;
  date?: ISODate;
  /** Day was written out (weekday / day / month), as opposed to implied. */
  hasDate: boolean;
  hasTime: boolean;
  start?: string;
  end?: string;
  role: Role;
  /** How the day was said: "abs" (a full date), "rel" (tomorrow, Sat…), "guess". */
  how: "abs" | "rel";
  /** A bare "5 baje"-style hour was guessed. */
  guessed: boolean;
}

const HINGLISH = /\b(?:baje|bje|kal|parso|parson|shaam|subah|savere|dopahar|aaj|agle|agla|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar|itwar|tarikh|mahine|hafte)\b|[ऀ-ॿ]/i;
const REAL_TIME = /\d\s*[:.]\s*\d\d|\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b|\bnoon\b|\bmidnight\b|o['’]clock/i;
const FULL_DATE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{4}\b/i;

/** The en.GB parser: "03/11/2026" is 3 November. */
const parser = chrono.en.GB;

function labelFor(lines: string[], i: number, at: number): string {
  const here = lines[i].slice(Math.max(0, at - 50), at);
  if (/[a-z]{3}/i.test(here)) return here;
  const prev = i > 0 ? lines[i - 1] : "";
  return prev.length <= 40 ? `${prev} ${here}` : here;
}

/** "GMT" / "BST" after a time: the app's clock is London time, so the label is dropped rather than converted. */
const stripTz = (l: string) => l.replace(/\s*\(?\b(?:GMT|BST|UTC|CEST|CET)\b\)?/g, "");
/** "15 minutes early", "within 7 days": a length of time, not a day. */
const DURATION = /^\s*(?:in\s+|within\s+|for\s+|about\s+|around\s+)?\d+(?:\s*-\s*\d+)?\s*(?:minutes?|mins?|hours?|hrs?|seconds?|days?|weeks?|months?)\b/i;

/**
 * "Nov 14", "November 14th, 2026": month first, as tickets and US-style emails write it. chrono's UK parser would read "Nov 14" as
 * November 2014 (month and two-digit year), so the day is put in front: "14 Nov". A four-digit year after the month ("Oct 2026") is left.
 */
export const dayFirst = (l: string) =>
  // (Not when a day is already in front of the month: "29 Oct 26" is the 29th of October 2026.)
  l.replace(/(?<!\d(?:st|nd|rd|th)?[ \t]*)\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?\b(?![ \t]*[:.]\d)/gi, "$2 $1");

function candidates(rawLines: string[], ref: Date): Cand[] {
  const lines = rawLines.map((l) => dayFirst(stripTz(l)));
  const out: Cand[] = [];
  // One line at a time: left to itself chrono joins "8:30 PM" at the end of one line to "Sat" at the start of the next.
  // (A day and a time on different lines are put together afterwards, by which is nearest.)
  const found = lines.flatMap((l, line) => parser.parse(l, ref, { forwardDate: true }).map((r) => ({ r, line })));
  for (const { r, line } of found) {
    const hasDate = r.start.isCertain("day") || r.start.isCertain("weekday") || r.start.isCertain("month");
    const hasTime = r.start.isCertain("hour") && (REAL_TIME.test(r.text) || r.start.isCertain("meridiem"));
    if (!hasDate && !hasTime) continue;
    if (DURATION.test(r.text)) continue;
    // A bare number that happens to look like a day ("Block 12") has no month and no weekday: not a date.
    if (hasDate && !r.start.isCertain("month") && !r.start.isCertain("weekday") && !/today|tonight|tomorrow|tmrw|yesterday|now|\d(?:st|nd|rd|th)\b/i.test(r.text)) {
      if (!hasTime) continue;
    }
    const at = r.index;
    const d = r.start.date();
    const end = r.end && r.end.isCertain("hour") ? hhmm(r.end.date()) : undefined;
    const how = FULL_DATE.test(r.text) ? "abs" : "rel";
    // chrono swaps "11/13/2026" itself when the UK reading is impossible: that is a guess, so it is marked unsure.
    const us = /\b(\d{1,2})\/(\d{1,2})\/\d{2,4}\b/.exec(r.text);
    const usSwap = !!us && +us[1] <= 12 && +us[2] > 12;
    const dateOnlyHour = usSwap || (hasTime && !r.start.isCertain("minute") && !r.start.isCertain("meridiem") && /^at\s+\d{1,2}$/i.test(r.text.trim()));
    out.push({
      line,
      at,
      text: r.text,
      date: hasDate ? toISO(d) : undefined,
      hasDate,
      hasTime,
      start: hasTime ? hhmm(d) : undefined,
      end: hasTime ? end : undefined,
      role: roleOf(labelFor(lines, line, at)),
      how,
      guessed: dateOnlyHour,
    });
  }
  // "13/11/2026" read the American way when the UK way is impossible (the month would be 13).
  if (!out.some((c) => c.hasDate)) {
    lines.forEach((l, line) => {
      for (const m of l.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
        const a = +m[1];
        const b = +m[2];
        if (a <= 12 && b > 12 && b <= 31) out.push({ line, at: m.index!, text: m[0], date: `${m[3]}-${pad(a)}-${pad(b)}`, hasDate: true, hasTime: false, role: roleOf(labelFor(lines, line, m.index!)), how: "abs", guessed: true });
      }
    });
  }
  return out;
}

// ---- Small pickers ---------------------------------------------------------------------------------------------------------------

const KNOWN_SOURCES: Array<[string, RegExp]> = [
  ["Eventbrite", /eventbrite/i],
  ["Ticketmaster", /ticketmaster/i],
  ["Dice", /\bdice(?:\.fm)?\b/i],
  ["See Tickets", /see ?tickets/i],
  ["Odeon", /\bodeon\b/i],
  ["Cineworld", /cineworld/i],
  ["Vue", /\bvue cinemas?\b/i],
  ["NHS", /\bnhs\b/i],
  ["Royal Mail", /royal ?mail/i],
  ["Amazon", /\bamazon\b/i],
  ["DPD", /\bdpd\b/i],
  ["Evri", /\b(?:evri|hermes)\b/i],
  ["Yodel", /\byodel\b/i],
  ["DHL", /\bdhl\b/i],
  ["UPS", /\bups\b/],
  ["FedEx", /fedex/i],
  ["Unitemps", /unitemps/i],
  ["King's Talent Bank", /king['’]?s talent bank/i],
  ["Pinnacle", /pinnacle/i],
  ["British Gas", /british gas/i],
  ["EDF", /\bedf\b/i],
  ["Octopus Energy", /octopus energy/i],
  ["E.ON", /\be\.?on\b/i],
  ["Scottish Power", /scottish ?power/i],
  ["Thames Water", /thames water/i],
  ["Barclaycard", /barclaycard/i],
  ["Capital One", /capital one/i],
  ["MBNA", /\bmbna\b/i],
  ["HMRC", /\bhmrc\b/i],
  ["DVLA", /\bdvla\b/i],
  ["WhatsApp", /whatsapp/i],
];

export function sourceOf(text: string): string | undefined {
  return KNOWN_SOURCES.find(([, re]) => re.test(text))?.[0];
}

const MONEY = /(?:£|GBP\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g;
const toMoney = (m: RegExpMatchArray) => Number(`${m[1].replace(/,/g, "")}.${m[2] ?? "00"}`);

interface Money {
  amount: number;
  line: number;
  label: string;
  after: string;
  /** Lower is better. */
  tier: number;
}

function findMoney(lines: string[], type: SnapType): Money[] {
  const found: Money[] = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(MONEY)) {
      const amount = toMoney(m);
      if (!(amount > 0) || amount > 1_000_000) continue;
      const before = l.slice(Math.max(0, m.index! - 40), m.index!);
      const label = /[a-z]{3}/i.test(before) ? before : `${i > 0 ? lines[i - 1].slice(-30) : ""} ${before}`;
      if (/\b(?:sav(?:e|ing|ed)|off|discount|refund|cashback|credit(?:ed)?|reward)\b/i.test(label)) continue;
      let tier = 4;
      if (type === "bill") {
        if (/\b(?:amount (?:due|to pay|owed)|total (?:due|to pay)|balance (?:due|to pay)|please pay|to pay|pay(?:ment)? (?:of|amount))\b/i.test(label)) tier = 1;
        else if (/\b(?:new balance|statement balance|closing balance|balance|total|instalment|installment|amount)\b/i.test(label)) tier = 2;
        else if (/\bminimum\b/i.test(label)) tier = 3;
      } else {
        // A "Total" beats a price, and a price beats a booking fee.
        const around = `${label} ${l.slice(m.index! + m[0].length, m.index! + m[0].length + 14)}`;
        if (/\b(?:total|amount due|to pay)\b/i.test(around)) tier = 0;
        else if (/\b(?:price|cost|per hour|\/\s?hr|\/h\b|hourly|rate)\b/i.test(around)) tier = 1;
        else if (/\b(?:fee|amount)\b/i.test(around)) tier = 2;
      }
      found.push({ amount, line: i, label, after: l.slice(m.index! + m[0].length, m.index! + m[0].length + 16), tier });
    }
    // OCR often reads "£" as "E": only trusted next to a payment word.
    if (!MONEY.test(l)) {
      MONEY.lastIndex = 0;
      const m = /\b(?:amount due|total due|balance|to pay|pay)\b[^0-9\n]{0,24}(?:[£E]\s?)?(\d{1,3}(?:,\d{3})*\.\d{2})\b/i.exec(l);
      if (m) found.push({ amount: Number(m[1].replace(/,/g, "")), line: i, label: l.slice(0, m.index + m[0].length), after: "", tier: 3 });
    }
    MONEY.lastIndex = 0;
  });
  return found;
}

function pickMoney(found: Money[], type: SnapType): { amount?: number; conf: number; note?: string } {
  if (!found.length) return { conf: 0 };
  const best = [...found].sort((a, b) => a.tier - b.tier || a.line - b.line)[0];
  let note: string | undefined;
  if (type === "bill") {
    const min = found.find((f) => f.tier === 3 && /\bminimum\b/i.test(f.label) && f.amount !== best.amount);
    if (min) note = `Minimum payment £${min.amount.toFixed(2)}`;
  }
  if (type === "shift" && /per hour|\/\s?hr|\bp\/h\b|hourly|an hour|\bph\b/i.test(`${best.label} ${best.after}`)) note = `£${best.amount.toFixed(2)} per hour`;
  const conf = best.tier <= 1 ? 0.9 : best.tier === 2 ? 0.75 : best.tier === 3 ? 0.62 : 0.5;
  return { amount: best.amount, conf: found.filter((f) => f.tier === best.tier && f.amount !== best.amount).length ? conf - 0.15 : conf, note };
}

const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/;

function pickLocation(lines: string[]): { location?: string; conf: number } {
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:venue|location|where|address|place|meeting point|collect from|pick ?-?up(?: point)?|site|clinic|surgery|hospital|department)\s*[:\-–]\s*(.*)$/i.exec(lines[i].trim());
    if (!m) continue;
    let v = m[1].trim();
    if (!v && lines[i + 1]) v = lines[i + 1].trim();
    else if (v && lines[i + 1] && (POSTCODE.test(lines[i + 1]) || /^\d/.test(lines[i + 1].trim())) && lines[i + 1].length < 70 && !POSTCODE.test(v)) v = `${v}, ${lines[i + 1].trim()}`;
    v = v.replace(/\s*[|·•]\s*.*$/, "").replace(/[.;]+$/, "").trim();
    if (v.length >= 3) return { location: v.slice(0, 90), conf: 0.9 };
  }
  // "Date and time" lines often carry the place after a bullet; a postcode line is the next best sign.
  const pc = lines.findIndex((l) => POSTCODE.test(l) && !/\b(?:po box|reply)\b/i.test(l));
  if (pc >= 0) {
    const l = lines[pc].trim();
    const prev = lines[pc - 1]?.trim();
    const v = l.length < 24 && prev && prev.length < 60 && !/\d{2,}[:/]/.test(prev) ? `${prev}, ${l}` : l;
    return { location: v.replace(/[.;]+$/, "").slice(0, 90), conf: 0.6 };
  }
  for (const l of lines) {
    const m = /\b(?:at|@)\s+(?:the\s+)?((?:[A-Z][\w'’&.-]*\s?){1,5})/.exec(l);
    if (m && !/^(?:The\s+)?(?:Start|End|Time|Date|Home|Work)\b/.test(m[1])) {
      const v = m[1].replace(/\b(?:Reply|Call|Text|Please|To|On|If|Thanks?|Thank)\b.*$/, "").split(/[.!?;]/)[0].trim();
      if (v.length >= 3) return { location: v, conf: 0.5 };
    }
  }
  return { conf: 0 };
}

const REF_LABEL = /\b(?:booking|order|confirmation|reference|ref|invoice|account|tracking|consignment|ticket|policy|membership|claim)\s*(?:number|no\.?|num|id|#|ref(?:erence)?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{4,24})\b/gi;

function pickReference(text: string): { reference?: string; conf: number } {
  for (const m of text.matchAll(REF_LABEL)) {
    const v = m[1];
    if (!/\d/.test(v) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(v) || /^(?:number|reference)$/i.test(v)) continue;
    return { reference: v.toUpperCase(), conf: 0.85 };
  }
  const rm = /\b[A-Z]{2}\d{9}[A-Z]{2}\b/.exec(text) ?? /\b1Z[0-9A-Z]{16}\b/.exec(text) ?? /\b\d{3}-\d{7}-\d{7}\b/.exec(text);
  return rm ? { reference: rm[0], conf: 0.8 } : { conf: 0 };
}

// ---- Titles --------------------------------------------------------------------------------------------------------------------

const BOILER =
  /^(?:your (?:tickets?|order|booking|appointment|delivery|statement|bill|parcel)\b|order (?:confirmation|summary|details|#|no)|booking (?:confirmation|reference|details)|thank(?:s| you)|hi\b|hello\b|dear\b|subject\b|from\b|to\b|date\b|time\b|location\b|venue\b|where\b|when\b|total\b|price\b|qty\b|quantity\b|ticket (?:type|holder)\b|reference\b|ref\b|account\b|amount\b|payment\b|balance\b|statement\b|invoice\b|view\b|click\b|download\b|add to calendar|manage\b|terms\b|privacy\b|unsubscribe\b|©|page \d|www\.|https?:|doors?\b|gates?\b|opens?\b|entry\b|admission\b|arriv\w*\b|finish\w*\b|begins?\b|kick-?off\b|curtain\b|show ?time\b|starts?\b|ends?\b|block\b|row\b|seat\b|sort code\b|minimum\b|please\b|sincerely|yours\b|regards\b|kind regards|best wishes|yours faithfully|important|notice\b|reminder\b|confirmed\b|approved\b)/i;

/** The words of a line once dates, times, prices and codes are taken out. */
function words(line: string, ref: Date): string {
  let t = line;
  // Only the parts that name a number or a month: a bare weekday in a title ("FRIDAY NIGHT LIVE") stays.
  for (const r of parser.parse(line, ref)) if (/\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|today|tomorrow|tonight/i.test(r.text)) t = t.replace(r.text, " ");
  return t
    .replace(MONEY, " ")
    .replace(/\b\d{1,2}\s*[:.]\s*\d\d\b/g, " ")
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, " ")
    .replace(/[|·•★✨–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(l: CleanLine, ref: Date, placeIsNotTitle = false): { score: number; text: string } {
  const text = words(l.text, ref);
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 3 || BOILER.test(l.text.trim()) || (POSTCODE.test(l.text) && letters < 12)) return { score: -9, text };
  // A line that is only the sender's name ("DICE", "Eventbrite") is a logo, not what the thing is.
  const brand = sourceOf(l.text);
  const only = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;
  if (brand && only(l.text) <= only(brand) + 4) return { score: -9, text };
  // A year in a name ("Wireless 2027") is not a sign of a date or a price line.
  const digits = (l.text.replace(/\b(?:19|20)\d{2}\b/g, "").match(/\d/g) ?? []).length;
  let score = letters / Math.max(1, l.text.length);
  // A price or a rate ("£12.50 per hour") is never what a thing is called, however big its box came out.
  const priceLine = /[£$€]\s?\d|\bper (?:hour|day|week|night)\b|\/\s?(?:hr|h)\b/i.test(l.text);
  score += l.size >= 1.15 && !priceLine ? Math.min(2, l.size) * 1.5 : 0;
  score -= priceLine ? 1.2 : 0;
  score += l.top < 0.45 ? 0.5 : 0;
  // The first line is usually what it is about; the venue line under it is not.
  score += l.i === 0 ? 0.4 : 0;
  score -= placeIsNotTitle && VENUE_WORDS.test(text) ? 0.7 : 0;
  score -= digits / Math.max(1, l.text.length) > 0.3 ? 1 : 0;
  score += text.length >= 4 && text.length <= 60 ? 0.5 : -0.5;
  return { score, text };
}

// The specific kinds first: "Clinic: Camden Physio" is a physio, not a hospital.
const KIND_OF_APPT: Array<[RegExp, string]> = [
  [/physio/i, "Physio"],
  [/dentist|dental/i, "Dentist"],
  [/optician|eye test|opticians/i, "Optician"],
  [/interview/i, "Interview"],
  [/vaccin|\bjab\b/i, "Vaccination"],
  [/blood test/i, "Blood test"],
  [/\bscan\b|x-?ray|\bmri\b|ultrasound/i, "Scan"],
  [/\bgp\b|surgery|doctor|\bdr\.?\s/i, "GP"],
  [/hospital|outpatient|clinic|consultant|nhs trust/i, "Hospital"],
];
/** These read as a title on their own; the rest are "<kind> appointment". */
const STANDALONE_KINDS = new Set(["Vaccination", "Blood test", "Scan", "Interview"]);

/** What a bill is for, by its words: the kind names the title ("Council tax bill"), the sender goes in front when it is known. */
const BILL_KINDS: Array<[RegExp, string]> = [
  [/council tax/i, "Council tax bill"],
  [/tv licen[cs]e/i, "TV licence"],
  [/\b(?:kwh|electricity|gas and electricity|dual fuel|energy)\b/i, "Energy bill"],
  [/\bwater\b.*\b(?:bill|charges|supply)\b|\bsewerage\b/i, "Water bill"],
  [/broadband|fibre|wi-?fi bill/i, "Broadband bill"],
  [/\b(?:credit card|card statement)\b/i, "Credit card statement"],
  [/mobile|sim only/i, "Phone bill"],
];

const VENUE_WORDS = /\b(?:arena|forum|ritz|institute|roundhouse|troxy|hall|theatre|theater|club|bar|pub|park|stadium|centre|center|academy|warehouse|cavern|ballroom|cinema|church|school|university|library|museum|gallery|inn|hotel|stage|o2|village|garden|gardens|studio|lounge|room|market)\b/i;

/** For tickets and posters: the place is usually the line next to the date. */
function guessVenue(lines: CleanLine[], dateLine: number, title: string, ref: Date): { location?: string; conf: number } {
  const near = lines.filter((l) => Math.abs(l.i - dateLine) <= 2 && l.i !== dateLine);
  for (const l of near) {
    // A line that is only a day ("Sat, Nov 14") is not a place.
    const t = words(l.text, ref).replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b\.?/gi, " ").replace(/\s+/g, " ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
    if (!t || t.toLowerCase() === title.toLowerCase() || BOILER.test(l.text.trim()) || MONEY.test(l.text)) continue;
    MONEY.lastIndex = 0;
    if (t.length < 4 || t.length > 70) continue;
    if (VENUE_WORDS.test(t) || (t.includes(",") && /\p{L}{3}/u.test(t))) return { location: cap(t.replace(/[.;]+$/, "")), conf: 0.5 };
  }
  MONEY.lastIndex = 0;
  return { conf: 0 };
}

const EVENT_TITLE =/(?:tickets?\s+(?:for|to)|order confirmation for|booking confirmed(?: for)?|you(?:'|’)re going to|you are going to|confirmed for|see you at|welcome to)\s+(.{3,70}?)(?=\s*(?:[.!?\n|·•]|$|\son\s\d|\s-\s|—|\s@))/i;

function pickTitle(type: SnapType, lines: CleanLine[], ref: Date, source: string | undefined, text: string, hint: { location?: string }): { title: string; conf: number } {
  const clean = (s: string) => cap(s.replace(/\s+/g, " ").replace(/^[\s,;:.\-–—·•|]+|[\s,;:.\-–—·•|]+$/g, "").slice(0, 80));
  const generic = () => {
    const ranked = lines.map((l) => ({ l, ...titleScore(l, ref, type === "event" || type === "appointment") })).filter((x) => x.score > -5 && x.text.length >= 3);
    ranked.sort((a, b) => b.score - a.score || a.l.i - b.l.i);
    const t = ranked[0]?.text;
    return t ? { title: clean(t), conf: ranked[0].l.size >= 1.15 ? 0.7 : 0.55 } : null;
  };
  switch (type) {
    case "event": {
      for (const l of lines) {
        const m = EVENT_TITLE.exec(l.text);
        if (m) return { title: clean(words(m[1], ref)), conf: 0.85 };
        // "You're going to" on one line, the name on the next.
        if (/(?:you(?:'|’)re|you are) going to\s*$|tickets?\s+(?:for|to)\s*$|order confirmation for\s*$|booking confirmed for\s*$/i.test(l.text) && lines[l.i + 1]) {
          const next = words(lines[l.i + 1].text, ref);
          if (next.length >= 3) return { title: clean(next), conf: 0.85 };
        }
      }
      return generic() ?? { title: "Event", conf: 0.3 };
    }
    case "appointment": {
      const kind = KIND_OF_APPT.find(([re]) => re.test(text))?.[1];
      if (kind) return { title: STANDALONE_KINDS.has(kind) ? kind : `${kind} appointment`, conf: 0.8 };
      return { title: source ? `${source} appointment` : "Appointment", conf: 0.6 };
    }
    case "bill": {
      const kind = BILL_KINDS.find(([re]) => re.test(text))?.[1];
      const statement = /\bstatement\b/i.test(text) && !/\bbill\b/i.test(text);
      if (kind) {
        const word = kind.split(" ")[0].toLowerCase();
        // "Thames Water" + "Water bill" is "Thames Water bill", not "Thames Water water bill".
        if (source && source.toLowerCase().includes(word)) return { title: clean(`${source} ${/statement/.test(kind.toLowerCase()) ? "statement" : "bill"}`), conf: 0.8 };
        const noun = kind.charAt(0).toLowerCase() + kind.slice(1);
        return { title: clean(source ? `${source} ${noun}` : kind), conf: 0.8 };
      }
      // "Rent due 1st of every month": what is before "due" is what it is for.
      const provider = source ?? generic()?.title.split(/\s+\bdue\b/i)[0];
      if (!provider) return { title: "Bill", conf: 0.3 };
      const base = provider.replace(/\s*\b(?:bill|statement|invoice)\b\s*$/i, "").trim();
      return { title: clean(`${base}${statement ? " statement" : " bill"}`), conf: source ? 0.8 : 0.55 };
    }
    case "delivery": {
      const carrier = source && source !== "WhatsApp" ? source : "Parcel";
      return { title: `${carrier}${carrier === "Parcel" ? " delivery" : /parcel|package/i.test(text) ? " parcel" : " delivery"}`, conf: source ? 0.8 : 0.6 };
    }
    case "shift": {
      // The share sheet's reader names a booking line well ("WTM Exhibition shift (Pinnacle) — Standby"). When it found no booking
      // line it falls back to the first line of the text, which says nothing: that one is not used.
      const joined = lines.map((l) => l.text).join("\n");
      const booked = parseShared(joined, ref);
      const firstLine = joined.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().split("\n")[0].replace(/[…]+/g, "").slice(0, 70).trim();
      // Only its composed titles ("… shift (Pinnacle) — Standby") are trusted: a plain line it picked up is not.
      if (booked?.title && booked.title !== "Event" && booked.title !== firstLine && /\bshift\b|—/.test(booked.title)) return { title: clean(booked.title), conf: 0.8 };
      for (const l of lines) {
        const role = /^(?:role|position|job|post|vacancy)\s*[:\-–]\s*(.{3,60})$/i.exec(l.text.trim());
        if (role) return { title: clean(/\bshift\b/i.test(role[1]) ? role[1] : `${role[1]} shift`), conf: 0.8 };
        const m = /\bshifts?(?:\s+available|\s+offer(?:ed)?)?\s*[:\-–]\s*([^,.\n]{4,60})/i.exec(l.text);
        if (m) return { title: clean(`${m[1]} shift`.replace(/\bshift\s+shift\b/i, "shift")), conf: 0.75 };
      }
      const g = generic();
      if (!g) return { title: hint.location ? `Shift at ${hint.location.split(",")[0]}` : source ? `${source} shift` : "Shift", conf: 0.5 };
      return { title: clean(/\bshift\b/i.test(g.title) ? g.title : `${g.title} shift${source ? ` (${source})` : ""}`), conf: g.conf * 0.9 };
    }
    case "deadline": {
      const g = generic();
      return g ?? { title: source ? `${source} letter` : "Deadline", conf: 0.4 };
    }
    default:
      return generic() ?? { title: hint.location ? `Visit ${hint.location}` : TYPE_LABEL[type], conf: 0.3 };
  }
}

// ---- One document, one item ------------------------------------------------------------------------------------------------------

const CAN_LIST: SnapType[] = ["shift", "event", "appointment", "delivery"];

interface Picked {
  date?: ISODate;
  dueDate?: ISODate;
  start?: string;
  end?: string;
  doors?: string;
  overnight?: string;
  dateLine: number;
  dateConf: number;
  timeConf: number;
  dueConf: number;
}

/** Chooses the day and the time from the roles of the dates and times found in these lines. */
function choose(type: SnapType, cands: Cand[], lines: CleanLine[]): Picked {
  const ok = cands.filter((c) => c.role !== "ignore");
  // A lone clock in the status area is never a time.
  const real = ok.filter((c) => !(c.hasTime && !c.hasDate && /^\s*\d{1,2}[:.]\d{2}\s*(?:[ap]m)?\s*$/i.test(lines[c.line]?.text ?? "") && (lines[c.line]?.top ?? 0.5) < 0.085));
  const dated = real.filter((c) => c.hasDate);
  const dueC = dated.filter((c) => c.role === "due");
  const startC = dated.filter((c) => c.role === "start" || c.role === "plain" || c.role === "doors");
  const rank = (c: Cand) => (c.role === "start" ? 0 : c.role === "plain" ? 1 : 2) - (c.hasTime ? 0.5 : 0) + (c.how === "abs" ? 0 : 0.3);
  const bestStart = [...startC].sort((a, b) => rank(a) - rank(b) || a.line - b.line)[0];
  // Several deadlines ("expires 1 Nov", "renew by 31 Oct"): the earliest is the one to act on.
  const bestDue = [...dueC].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.line - b.line)[0];
  let date: ISODate | undefined;
  let dueDate: ISODate | undefined;
  let dateConf = 0;
  let dueConf = 0;
  const confOf = (c: Cand) => (c.how === "abs" ? (c.role === "plain" ? 0.8 : 0.92) : c.role === "plain" ? 0.72 : 0.82) * (c.guessed ? 0.7 : 1);
  if (type === "bill") {
    const c = bestDue ?? bestStart;
    if (c) {
      dueDate = c.date;
      date = c.date;
      dueConf = dateConf = confOf(c) * (bestDue ? 1 : 0.8);
    }
  } else {
    if (bestStart) {
      date = bestStart.date;
      dateConf = confOf(bestStart) * (startC.filter((c) => c.date !== bestStart.date && c.role === bestStart.role).length ? 0.8 : 1);
    }
    if (bestDue && bestDue.date !== date) {
      dueDate = bestDue.date;
      dueConf = confOf(bestDue);
    }
    if (!date && dueDate) {
      date = dueDate;
      dateConf = dueConf * 0.9;
    }
  }

  // Times: next to the chosen day first, a start beats the doors, a lone time is a guess.
  const dateLine = [...startC, ...dueC].find((c) => c.date === date)?.line ?? bestStart?.line ?? 0;
  const timed = real.filter((c) => c.hasTime);
  const near = (c: Cand) => Math.abs(c.line - dateLine);
  const order = (a: Cand, b: Cand) => near(a) - near(b) || a.line - b.line || a.at - b.at;
  const startT = [...timed.filter((c) => c.role === "start")].sort(order)[0] ?? [...timed.filter((c) => c.role === "plain")].sort(order)[0];
  const doorsT = [...timed.filter((c) => c.role === "doors")].sort(order)[0];
  const endT = [...timed.filter((c) => c.role === "end")].sort(order)[0];
  const first = startT ?? (type === "event" ? doorsT : undefined);
  let start = first?.start;
  let end = first?.end ?? (start ? endT?.start : undefined);
  if (type === "bill") {
    start = undefined;
    end = undefined;
  }
  // Ends after midnight ("9pm to 3am"): the end is dropped rather than put on the wrong day, and said in the notes.
  let overnight: string | undefined;
  if (start && end && minOf(end) <= minOf(start)) {
    overnight = end;
    end = undefined;
  }
  const timeConf = first ? (first.role === "start" ? 0.9 : first.role === "doors" ? 0.65 : 0.65) * (first.guessed ? 0.7 : 1) * (near(first) > 3 ? 0.8 : 1) : 0;
  return { date, dueDate, start, end, overnight, dateLine, doors: doorsT && start && doorsT.start !== start ? doorsT.start : undefined, dateConf: clamp01(dateConf), timeConf: clamp01(timeConf), dueConf: clamp01(dueConf) };
}

function build(type: SnapType, lines: CleanLine[], ctx: ExtractCtx, fullText: string, trust: number): SnapItem | null {
  const texts = lines.map((l) => (HINGLISH.test(l.text) ? normalizeHinglish(l.text) : l.text));
  const cands = candidates(texts, ctx.ref);
  const pick = choose(type, cands, lines);
  const text = lines.map((l) => l.text).join("\n");
  const source = sourceOf(fullText);
  const money = pickMoney(findMoney(lines.map((l) => l.text), type), type);
  const ref = findSensitive(fullText).length ? { conf: 0 } : pickReference(text);

  // A staffing booking in the usual email layout ("Pinnacle … Approved … Tue, 3 Nov 2026 (07:00-10:00 GMT) · …") is read by the
  // reader the share sheet already uses, which knows that convention (GMT is London winter time).
  const booked = type === "shift" ? parseShared(text, ctx.ref) : null;
  if (booked && booked.start && (!pick.date || pick.date === booked.date)) {
    pick.date = booked.date;
    pick.start = booked.start;
    pick.end = booked.end;
    pick.dateConf = Math.max(pick.dateConf, 0.9);
    pick.timeConf = Math.max(pick.timeConf, 0.9);
  }

  let loc = pickLocation(lines.map((l) => l.text));
  const t = pickTitle(type, lines, ctx.ref, source, text, loc);
  if (!loc.location && (type === "event" || type === "appointment")) loc = guessVenue(lines, pick.dateLine, t.title, ctx.ref);
  // The recogniser reads the letter O of "O2 Arena" as a zero, the commonest slip in venue names.
  if (loc.location) loc = { ...loc, location: loc.location.replace(/\b02\b(?=\s+(?:Arena|Academy|Forum|Shepherd|Brixton|Institute|Ritz|Centre|Center|Kentish))/gi, "O2") };
  if (!pick.date && !pick.dueDate && money.amount === undefined && !t.title) return null;

  const item: SnapItem = { type, title: t.title, conf: {} };
  const trustF = trust >= 0.85 ? 1 : 0.85 + (trust - 0.55) * 0.5;
  const put = (f: FieldName, conf: number) => {
    item.conf[f] = clamp01(conf * (f === "title" || f === "date" || f === "start" || f === "end" ? trustF : 1));
  };
  put("title", t.conf);
  if (pick.date) {
    item.date = pick.date;
    put("date", pick.dateConf);
  }
  if (pick.dueDate && pick.dueDate !== pick.date) {
    item.dueDate = pick.dueDate;
    put("dueDate", pick.dueConf);
  } else if (type === "bill" && pick.dueDate) {
    item.dueDate = pick.dueDate;
    put("dueDate", pick.dueConf);
  }
  if (pick.start) {
    item.start = pick.start;
    put("start", pick.timeConf);
    if (pick.end) {
      item.end = pick.end;
      put("end", pick.timeConf * 0.9);
    }
  }
  if (loc.location) {
    item.location = loc.location;
    put("location", loc.conf);
  }
  if (money.amount !== undefined) {
    item.amount = money.amount;
    put("amount", money.conf);
  }
  if (ref.reference) {
    item.reference = ref.reference;
    put("reference", ref.conf);
  }
  if (source) item.source = source;
  const notes = [pick.doors ? `Doors ${pick.doors}` : "", pick.overnight ? `Ends ${pick.overnight} (after midnight)` : "", type === "bill" && /direct debit/i.test(text) ? "Direct Debit" : "", money.note ?? ""].filter(Boolean).join(" · ");
  if (notes) item.notes = notes;

  // A day that is already past (a screenshot kept for a while): ask rather than save it quietly.
  const today = toISO(ctx.now);
  if (item.date && item.date < today && type !== "bill") {
    item.checkDate = true;
    item.conf.date = Math.min(item.conf.date ?? 1, 0.4);
  }
  return item;
}

// ---- A list of events or shifts -----------------------------------------------------------------------------------------------------

function split(lines: CleanLine[], ctx: ExtractCtx): CleanLine[][] | null {
  const cands = candidates(lines.map((l) => (HINGLISH.test(l.text) ? normalizeHinglish(l.text) : l.text)), ctx.ref).filter((c) => c.hasDate && (c.role === "start" || c.role === "plain" || c.role === "doors"));
  const firstByDate = new Map<string, Cand>();
  // A bare weekday in a title ("FRIDAY NIGHT LIVE") is not another day when a full date is written.
  const pool = cands.some((c) => c.how === "abs") ? cands.filter((c) => c.how === "abs") : cands;
  for (const c of pool) if (c.date && !firstByDate.has(c.date)) firstByDate.set(c.date, c);
  const anchors = [...firstByDate.values()].sort((a, b) => a.line - b.line);
  // One anchor per line, and more than one day: a list.
  const lineSet = [...new Set(anchors.map((a) => a.line))];
  if (anchors.length < 2 || lineSet.length < anchors.length) return null;

  const headingLike = (l?: CleanLine) => !!l && l.text.length <= 60 && !cands.some((c) => c.line === l.i) && !MONEY.test(l.text) && /\p{L}{3}/u.test(l.text) && !BOILER.test(l.text.trim());
  MONEY.lastIndex = 0;
  const titleFirst = lineSet[0] > 0 && headingLike(lines[lineSet[0] - 1]) && lineSet.slice(1).every((ln) => headingLike(lines[ln - 1]));
  const chunks: CleanLine[][] = [];
  lineSet.forEach((ln, k) => {
    const from = titleFirst ? ln - 1 : ln;
    const to = k + 1 < lineSet.length ? (titleFirst ? lineSet[k + 1] - 1 : lineSet[k + 1]) : lines.length;
    chunks.push(lines.slice(from, to));
  });
  return chunks;
}

// ---- Chat-style text -----------------------------------------------------------------------------------------------------------------

const CUE =
  /\b(?:today|tonight|tomorrow|tmrw|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b|\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|(?<![£$€\d.])\b\d{1,2}[:.]\d{2}\b|\bat\s+\d|\b\d{1,2}(?:st|nd|rd|th)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:kal|parso|parson|aaj|baje|bje|shaam|subah|raat|dopahar|agle|agla|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar|itwar|tarikh)\b/i;

const CUE_ALL = new RegExp(CUE.source, "gi");
/** How many words of its own a line has once its day and time words are taken out. */
const ownWords = (t: string) => t.replace(CUE_ALL, " ").split(/[^\p{L}]+/u).filter((w) => w.length >= 2).length;

/** Every line that says when is just a day or a time (at most one other word), and there is more than one line. */
function isFragmentary(lines: CleanLine[]): boolean {
  const cues = lines.filter((l) => CUE.test(l.text));
  return lines.length >= 2 && cues.length > 0 && cues.every((l) => ownWords(l.text) <= 1);
}

/** A chat line's title without the "hey", "yes!" and stray question marks the date words leave behind. */
function tidyChatTitle(t: string): string {
  const s = t
    .replace(/^(?:(?:hey|hi|hello|yes|yeah|yep|yup|no|ok|okay|sure|haha|lol|so|and|also|btw|please|pls)\b[\s,!.]*)+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([?!.,])/g, "$1")
    .replace(/^[\s,;:!?.\-–]+|[\s,;:!?.\-–]+$/g, "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "03/11/2026" and "3.11.26" in UK order, written out ("3 November 2026") so the app's capture parser, which reads a bare 03/11 the
 * American way, cannot get it wrong. A month above 12 means it was written the American way; that is read, and reported as unsure.
 */
export function ukDates(s: string): { text: string; swapped: boolean } {
  let swapped = false;
  const text = s.replace(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g, (m, a: string, b: string, y: string) => {
    let d = +a;
    let mo = +b;
    if (mo > 12 && d <= 12) {
      [d, mo] = [mo, d];
      swapped = true;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return m;
    return `${d} ${MONTH_NAMES[mo - 1]} ${y.length === 2 ? 2000 + +y : +y}`;
  });
  return { text, swapped };
}

function readChat(lines: CleanLine[], ctx: ExtractCtx, trust: number): SnapItem[] {
  const profile = ctx.profile ?? withDefaults();
  const out: SnapItem[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!CUE.test(l.text) || out.length >= 8) continue;
    // A question with no clock time in it ("are you free sat?") is asking, not planning.
    if (/\?\s*$/.test(l.text.trim()) && !/\d/.test(l.text)) continue;
    const uk = ukDates(l.text);
    const p = promoteEvent(parseCapture(uk.text, ctx.ref, profile));
    if (!p.due || !p.title) continue;
    p.title = tidyChatTitle(p.title) || p.title;
    // "13 7:30pm", "·": what is left of a line that was only a date is not a title; the line above it is.
    const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
    if (letters(p.title) < 3) {
      const above = lines[l.i - 1] ? words(lines[l.i - 1].text, ctx.ref) : "";
      if (letters(above) < 3 || BOILER.test(above)) continue;
      p.title = above;
    }
    const key = `${p.title.toLowerCase()}|${p.due}|${p.dueTime ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let guessed = /\b(?:baje|bje)\b/i.test(l.text) && !/\b(?:subah|shaam|raat|dopahar|savere)\b/i.test(l.text);
    // "book at 7.45" with no am or pm and no 24-hour zero ("07:45"): a plan in the early hours is unlikely, so it is the evening.
    if (p.dueTime && +p.dueTime.slice(0, 2) >= 1 && +p.dueTime.slice(0, 2) <= 7 && !/\b(?:am|a\.m\.)\b|\b0\d[:.]\d\d\b|\bmorning\b|subah|savere/i.test(l.text) && !/\b(?:baje|bje)\b/i.test(l.text)) {
      p.dueTime = `${String(+p.dueTime.slice(0, 2) + 12).padStart(2, "0")}${p.dueTime.slice(2)}`;
      if (p.dueEndTime && +p.dueEndTime.slice(0, 2) <= 11) p.dueEndTime = `${String(+p.dueEndTime.slice(0, 2) + 12).padStart(2, "0")}${p.dueEndTime.slice(2)}`;
      guessed = true;
    }
    const item: SnapItem = { type: "plan", title: cap(p.title.slice(0, 80)), date: p.due, conf: {} };
    const f = trust >= 0.85 ? 1 : 0.85 + (trust - 0.55) * 0.5;
    item.conf.title = 0.7 * f;
    item.conf.date = (uk.swapped ? 0.5 : 0.8) * f;
    if (p.dueTime) {
      item.start = p.dueTime;
      item.conf.start = (guessed ? 0.55 : 0.8) * f;
      if (p.dueEndTime && minOf(p.dueEndTime) > minOf(p.dueTime)) {
        item.end = p.dueEndTime;
        item.conf.end = 0.7 * f;
      }
    }
    if (p.due < toISO(ctx.now)) {
      item.checkDate = true;
      item.conf.date = Math.min(item.conf.date ?? 1, 0.4);
    }
    out.push(item);
  }
  if (!out.length) {
    const first = lines.map((l) => l.text).find((t) => /\p{L}{3}/u.test(t) && !BOILER.test(t.trim()));
    if (first) {
      const all = lines.map((l) => l.text).join("\n").slice(0, 800);
      out.push({ type: "note", title: cap(first.replace(/\s+/g, " ").trim().slice(0, 60)), ...(all.length > first.length + 2 ? { notes: all } : {}), conf: { title: 0.5 } });
    }
  }
  return out;
}

// ---- Everything together ----------------------------------------------------------------------------------------------------------

/** Reads a cleaned page: what kind of document it is, and every item in it. */
export function readCleanPage(page: CleanPage, ctx: ExtractCtx): SnapReading {
  const rawText = page.text;
  const sensitive = findSensitive(rawText).length > 0;
  const text = sensitive ? maskSensitive(rawText) : rawText;
  const letters = (rawText.match(/\p{L}/gu) ?? []).length;
  const weak = letters < 20 || page.trust < 0.55;
  if (!page.lines.length) return { docType: "note", items: [], text, sensitive, weak: true, rawText };

  const kind = classify(rawText);
  let docType: SnapType;
  let items: SnapItem[] = [];
  if (kind) {
    docType = kind.type;
    const chunks = CAN_LIST.includes(docType) ? split(page.lines, ctx) : null;
    const parts = chunks ?? [page.lines];
    items = parts.map((c) => build(docType, c, ctx, rawText, page.trust)).filter((x): x is SnapItem => !!x);
    // A document with nothing recognisable in it (no day, no money) is a note.
    items = items.filter((it) => it.date || it.dueDate || it.amount !== undefined);
  } else if (isFragmentary(page.lines)) {
    // No kind of document is named, but the day, the time and the place sit on separate lines of one thing (a poster, a ticket
    // photographed without its heading): it is read as one event, not as a conversation.
    docType = "event";
    const one = build("event", page.lines, ctx, rawText, page.trust);
    items = one && one.date ? [one] : [];
    if (!items.length) {
      docType = "plan";
      items = readChat(page.lines, ctx, page.trust);
      if (items.every((i) => i.type === "note")) docType = "note";
    }
  } else {
    docType = "plan";
    items = readChat(page.lines, ctx, page.trust);
    if (items.every((i) => i.type === "note")) docType = "note";
  }
  // Card numbers, account details and the like are masked in anything that could be saved.
  if (sensitive) items = items.map((it) => ({ ...it, title: maskSensitive(it.title), ...(it.notes ? { notes: maskSensitive(it.notes) } : {}), ...(it.location ? { location: maskSensitive(it.location) } : {}) }));
  return { docType, items, text, sensitive, weak, rawText };
}

/** From recognised text lines to items (the whole offline pipeline for one image). */
export function readPage(page: OcrPage, ctx: ExtractCtx): SnapReading {
  return readCleanPage(cleanPage(page), ctx);
}
