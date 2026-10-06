import * as chrono from "chrono-node";
import { toISO } from "./dates";
import { normalizeHinglish } from "./hinglish";
import { inferArea } from "./areas";
import { inferCountsFor } from "./fixed";
import { expandShortcuts, findArea, withDefaults } from "./profile";
import { extractRecurrence, firstOccurrence } from "./recur";
import type { ISODate, Profile, Recurrence, TemplateId } from "./types";

export interface ParsedCapture {
  /** What this capture creates: a task (default), a fixed event ("event …") or shopping-list items ("groceries: …"). */
  kind?: "task" | "event" | "grocery";
  /** For events: the block it occupies. No start = all day. */
  event?: { start?: string; end?: string; countsFor?: string };
  /** For "groceries: milk, sugar". */
  groceryItems?: string[];
  title: string;
  due?: ISODate;
  dueTime?: string;
  /** End of a range like "6pm to 8pm". */
  dueEndTime?: string;
  important: boolean;
  tags: string[];
  estimateMin?: number;
  template?: TemplateId;
  recur?: Recurrence;
  /** Life area id, from "@family". */
  area?: string;
  /** Any links in the text are kept here, out of the way of the date parser. */
  notes?: string;
}

const TEMPLATE_WORDS: Record<string, TemplateId> = {
  project: "project",
  trip: "trip",
  job: "job",
  application: "job",
  admin: "admin",
  paperwork: "admin",
  event: "event",
  occasion: "event",
};

/** "~30m", "~1h", "~1h30m", "~1.5h", "~45" (bare number = minutes). Returns the text without the token. */
export function extractEstimate(text: string): { text: string; estimateMin?: number } {
  const re = /(^|\s)~((?:\d+(?:\.\d+)?h)?(?:\d+m?)?)(?=\s|$)/i;
  const m = re.exec(text);
  if (!m || !m[2]) return { text };
  const inner = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m?)?$/i.exec(m[2]);
  if (!inner) return { text };
  const mins = Math.round(parseFloat(inner[1] ?? "0") * 60 + parseInt(inner[2] ?? "0", 10));
  if (!mins) return { text };
  return { text: text.replace(re, " "), estimateMin: Math.min(mins, 24 * 60) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function endOfWeek(now: Date): Date {
  // Week ends Sunday.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d;
}

/** Coming Saturday; Sunday counts as already "the weekend". */
function thisWeekend(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? 0 : 6 - dow));
  return d;
}

export function parseCapture(raw: string, now = new Date(), profile?: Profile): ParsedCapture {
  const me = profile ?? withDefaults();

  // "groceries: milk, sugar" fills the shopping list. Nothing else touches that list.
  const shop = /^\s*(?:grocery|groceries|shopping(?:\s+list)?|list)\s*[:-]\s*(.+)$/is.exec(raw);
  if (shop) {
    const items = [...new Set(shop[1].split(/[,;\n]|\s+and\s+/i).map((x) => x.trim()).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)))];
    return { kind: "grocery", groceryItems: items, title: items.join(", "), important: false, tags: [] };
  }

  // "event Wednesday 6pm dinner" is a fixed block: sessions flow around it.
  const ev = /^\s*event\b\s*[:-]?\s*/i.exec(raw);
  if (ev) {
    const inner = parseCapture(raw.slice(ev[0].length), now, profile);
    const start = inner.dueTime;
    const dur = inner.estimateMin;
    const end =
      inner.dueEndTime ??
      (start && dur ? `${String(Math.floor((toMinutes(start) + dur) / 60) % 24).padStart(2, "0")}:${String((toMinutes(start) + dur) % 60).padStart(2, "0")}` : undefined);
    return {
      ...inner,
      kind: "event",
      due: inner.due ?? toISO(now),
      event: { start, end, countsFor: inferCountsFor(inner.title, me.areas) },
      area: undefined,
    };
  }

  // Links first: their digits and slashes confuse the date parser.
  const urls: string[] = [];
  const noUrls = raw.replace(/https?:\/\/\S+/gi, (u) => {
    urls.push(u.replace(/[.,;)]+$/, ""));
    return " ";
  });

  // Personal phrases first ("office ke baad" → "at 18:30"), then Hinglish → English.
  let text = ` ${normalizeHinglish(expandShortcuts(noUrls, me))} `;
  let area: string | undefined;
  let important = false;
  const tags: string[] = [];
  let template: TemplateId | undefined;

  const est = extractEstimate(text);
  text = est.text;

  text = text.replace(/(^|\s)#([\p{L}\p{M}\p{N}_-]+)/gu, (_, sp, tag) => {
    const t = String(tag).toLowerCase();
    if (!tags.includes(t)) tags.push(t);
    return sp;
  });

  // @family, @work… (only names that match one of your areas)
  text = text.replace(/(^|\s)@([\p{L}\p{M}\p{N}_-]+)/gu, (full, sp, word) => {
    const a = findArea(me.areas, String(word));
    if (!a) return full;
    area = a.id;
    return sp;
  });

  text = text.replace(/(^|\s)\/([a-z]+)(?=\s|$)/gi, (full, sp, word) => {
    const id = TEMPLATE_WORDS[String(word).toLowerCase()];
    if (!id) return full;
    template = id;
    return sp;
  });

  // "!" as its own word, or trailing
  text = text.replace(/(^|\s)!+(?=\s|$)/g, (_, sp) => {
    important = true;
    return sp;
  });
  if (/!+\s*$/.test(text)) {
    important = true;
    text = text.replace(/!+(\s*)$/, "$1");
  }

  const rec = extractRecurrence(text);
  text = rec.text;

  let due: ISODate | undefined;
  let dueTime: string | undefined;
  let dueEndTime: string | undefined;

  const readTime = (hit: chrono.ParsedResult) => {
    if (!hit.start.isCertain("hour")) return undefined;
    const d = hit.start.date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const custom = /\b(?:by\s+|before\s+)?(?:the\s+)?end of (?:this\s+|the\s+)?(week|month)\b/i.exec(text);
  const weekend = /\b(?:(?:on|by|this|the)\s+)*weekend\b/i.exec(text);
  const dayOfMonth = /\b(?:(?:on|by|the)\s+)*(\d{1,2})(?:st|nd|rd|th)\b(?!\s+of\b)/i.exec(text);
  const hits = chrono.parse(text, now, { forwardDate: true });
  const hit = hits.find((h) => h.text.trim().length >= 3);

  if (rec.recur) {
    // The repeat rule decides the date; chrono only contributes a time like "9am".
    due = firstOccurrence(rec.recur, toISO(now));
    if (hit) {
      dueTime = readTime(hit);
      text = text.slice(0, hit.index) + " " + text.slice(hit.index + hit.text.length);
    }
  } else if (custom) {
    due =
      custom[1].toLowerCase() === "week"
        ? toISO(endOfWeek(now))
        : toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    text = text.replace(custom[0], " ");
  } else if (weekend) {
    due = toISO(thisWeekend(now));
    text = text.replace(weekend[0], " ");
  } else if (hit) {
    due = toISO(hit.start.date());
    dueTime = readTime(hit);
    if (hit.end && hit.end.isCertain("hour")) {
      const e = hit.end.date();
      dueEndTime = `${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`;
    }
    const before = text.slice(0, hit.index).replace(/\b(by|on|due|before|until|for|at)\s*$/i, "");
    text = before + " " + text.slice(hit.index + hit.text.length);
  } else if (dayOfMonth) {
    // A bare "15th" (chrono ignores it): the next 15th, counting today.
    due = firstOccurrence({ freq: "monthly", interval: 1, monthDay: Math.min(31, +dayOfMonth[1]) }, toISO(now));
    text = text.replace(dayOfMonth[0], " ");
  }

  let title = text.replace(/\s+/g, " ").trim().replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  if (!title) title = noUrls.replace(/[!~#/]\S*/g, "").trim() || noUrls.trim();
  if (!title && urls[0]) {
    try {
      title = new URL(urls[0]).hostname.replace(/^www\./, "");
    } catch {
      title = urls[0];
    }
  }
  title = title.charAt(0).toUpperCase() + title.slice(1);
  // No @area given: guess from the words, else Others.
  area = area ?? inferArea(title, me.areas);

  return {
    title,
    due,
    dueTime,
    dueEndTime,
    important,
    tags,
    estimateMin: est.estimateMin,
    template,
    recur: rec.recur,
    area,
    notes: urls.length ? urls.join("\n") : undefined,
  };
}
