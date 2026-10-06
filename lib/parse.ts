import * as chrono from "chrono-node";
import { toISO } from "./dates";
import type { ISODate, TemplateId } from "./types";

export interface ParsedCapture {
  title: string;
  due?: ISODate;
  dueTime?: string;
  important: boolean;
  tags: string[];
  estimateMin?: number;
  template?: TemplateId;
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

function endOfWeek(now: Date): Date {
  // Week ends Sunday.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d;
}

export function parseCapture(raw: string, now = new Date()): ParsedCapture {
  let text = ` ${raw.trim()} `;
  let important = false;
  const tags: string[] = [];
  let template: TemplateId | undefined;

  const est = extractEstimate(text);
  text = est.text;

  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, sp, tag) => {
    const t = String(tag).toLowerCase();
    if (!tags.includes(t)) tags.push(t);
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

  let due: ISODate | undefined;
  let dueTime: string | undefined;

  const custom = /\b(?:by\s+|before\s+)?(?:the\s+)?end of (?:this\s+|the\s+)?(week|month)\b/i.exec(text);
  if (custom) {
    due =
      custom[1].toLowerCase() === "week"
        ? toISO(endOfWeek(now))
        : toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    text = text.replace(custom[0], " ");
  } else {
    const hits = chrono.parse(text, now, { forwardDate: true });
    const hit = hits.find((h) => h.text.trim().length >= 3);
    if (hit) {
      const d = hit.start.date();
      due = toISO(d);
      if (hit.start.isCertain("hour")) {
        dueTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
      const before = text.slice(0, hit.index).replace(/\b(by|on|due|before|until|for|at)\s*$/i, "");
      text = before + " " + text.slice(hit.index + hit.text.length);
    }
  }

  let title = text.replace(/\s+/g, " ").trim().replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  if (!title) title = raw.replace(/[!~#/]\S*/g, "").trim() || raw.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { title, due, dueTime, important, tags, estimateMin: est.estimateMin, template };
}
