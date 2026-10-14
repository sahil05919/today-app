import type { OcrLine, OcrPage } from "./types";

/**
 * Step C: take the phone-screenshot chrome out of the recognised text, using position (the top and bottom strips) and patterns.
 * The status-bar clock ("12:45"), the battery, the carrier, the keyboard and the app's own buttons never reach the reader, and a
 * chat's message times are dropped, so none of them can become an event time.
 */
export interface CleanLine extends OcrLine {
  /** Position in the cleaned list. */
  i: number;
  /** Line height, a proxy for how big the text is. */
  h: number;
  /** Height relative to the median line (1 = ordinary text). */
  size: number;
  /** 0 at the top of the picture, 1 at the bottom. */
  top: number;
}

export interface CleanPage {
  lines: CleanLine[];
  text: string;
  dropped: string[];
  /** Looks like a phone screenshot (tall and narrow). */
  screenshot: boolean;
  /** 0..1: how much the recogniser trusted what it read (1 when it gave no figure). */
  trust: number;
}

const CLOCK = /^\s*\d{1,2}\s*[:.]\s*\d{2}\s*(?:[ap]\.?m\.?)?\s*$/i;
const CARRIER = /^\s*(?:ee|o2|vodafone|three|3 uk|giffgaff|tesco mobile|voxi|lebara|id mobile|sky mobile|smarty|bt mobile|virgin(?: media)?|verizon|at&t|t-mobile|4g|5g|lte|3g|wi-?fi|vo?lte|no service|sos|airplane mode)\s*$/i;
const BATTERY = /^\s*\d{1,3}\s*%\s*$/;
const SYMBOLS_ONLY = /^[^\p{L}\p{N}£$€]*$/u;

/** Buttons and bars from mail, chat, browser and gallery apps: only a line that is nothing else is dropped. */
const CHROME_WORDS = new RegExp(
  "^\\s*(?:gmail|outlook|whatsapp|messenger|telegram|signal|instagram|reply(?: all)?|forward|share|archive|delete|trash|spam|report|mark as (?:un)?read|mark unread|snooze|move|label|more|back|menu|search|inbox|compose|send|cancel|done|save|close|edit|copy|select(?: all)?|paste|print|open|view|like|comment|follow|following|home|settings|notifications|messages|primary|social|promotions|updates|online|last seen.*|typing\\.\\.\\.|type a message|message|write a reply|reply to .*|add a caption\\.{0,3}|ok|got it|allow|deny|skip|next|previous|photos|albums|library|for you|screenshot|screenshots|just now|sent|delivered|read|seen|starred|unsubscribe|view in browser|show quoted text|show trimmed content|to me|\\d+ (?:new )?messages?|tap to .*|swipe .*)\\s*$",
  "i",
);
const CHAT_SEPARATOR = /^\s*(?:today|yesterday|tomorrow)\s*$/i;
const KEYBOARD_WORDS = /^\s*(?:space|return|enter|go|123|abc|\?123|emoji|gif|q w e r t y|@|#)\s*$/i;
const TICKS = /\s*(?:[✓✔√]+|v{1,2}|vv|✓✓|✔✔|read|delivered|edited)\s*$/iu;
/** A time glued to the end of a chat bubble: "party sat 8pm at mine 10:42 ✓✓". */
const TRAILING_STAMP = /\s+\d{1,2}[:.]\d{2}\s*(?:[ap]m)?\s*(?:[✓✔√]+|vv?)\s*$/iu;

const median = (xs: number[]) => {
  if (!xs.length) return 1;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 1;
};

const isLoneKeys = (t: string) => {
  const parts = t.trim().split(/\s+/);
  return parts.length >= 6 && parts.filter((p) => p.length === 1).length / parts.length >= 0.8;
};

/** A single status-bar item: the clock, the battery, a signal word or a lone icon glyph. */
function statusItem(t: string): boolean {
  return CLOCK.test(t) || BATTERY.test(t) || CARRIER.test(t) || SYMBOLS_ONLY.test(t);
}

export function cleanPage(page: OcrPage): CleanPage {
  const H = Math.max(1, page.height);
  const W = Math.max(1, page.width);
  const screenshot = H / W >= 1.6;
  const heights = page.lines.map((l) => Math.max(1, l.y1 - l.y0));
  const med = median(heights);
  const dropped: string[] = [];
  const kept: OcrLine[] = [];

  // The status bar lives in the top few percent of a screenshot; on an ordinary photo only a thinner strip is trusted.
  const topStrip = screenshot ? 0.085 : 0.04;
  const bottomStrip = screenshot ? 0.93 : 0.97;

  for (const l of page.lines) {
    // A recognised line is a few dozen characters; one over 400 is noise, and is cut so no pattern can be made to run long on it.
    const raw = l.text.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!raw) continue;
    const mid = (l.y0 + l.y1) / 2 / H;
    const h = Math.max(1, l.y1 - l.y0);
    const xMid = (l.x0 + l.x1) / 2 / W;
    const drop = (why: string) => dropped.push(`${why}: ${raw}`);

    // Top strip: clock, battery, carrier, signal. Nothing in it is a plan.
    if (mid < topStrip && statusItem(raw)) {
      drop("status bar");
      continue;
    }
    // A combined status line ("12:45  EE  5G  78%") is a run of status items.
    if (mid < topStrip && raw.split(" ").every((w) => statusItem(w)) && raw.split(" ").some((w) => CLOCK.test(w) || BATTERY.test(w))) {
      drop("status bar");
      continue;
    }
    // Bottom strip: navigation bar and the keyboard's function row.
    if (mid > bottomStrip && (SYMBOLS_ONLY.test(raw) || KEYBOARD_WORDS.test(raw) || raw.length <= 2)) {
      drop("navigation bar");
      continue;
    }
    // Keyboard rows in the lower half of a screenshot: "q w e r t y u i o p".
    if (screenshot && mid > 0.5 && (isLoneKeys(raw) || KEYBOARD_WORDS.test(raw))) {
      drop("keyboard");
      continue;
    }
    if (CHROME_WORDS.test(raw)) {
      drop("app button");
      continue;
    }
    if (CHAT_SEPARATOR.test(raw)) {
      drop("chat date separator");
      continue;
    }
    // A chat bubble's own time: small, right-hand, nothing else on the line.
    if (CLOCK.test(raw) && screenshot && xMid > 0.6 && h < med * 0.85 && mid > topStrip) {
      drop("message time");
      continue;
    }
    if (SYMBOLS_ONLY.test(raw)) {
      drop("icon");
      continue;
    }
    // A stray accent glued to a pound sign ("Ä£12.50", seen from the real recogniser) is noise, and it makes the line taller.
    let text = raw.replace(/[ÂÃÄÅ]+(?=\s?[£$€])/g, "").replace(TRAILING_STAMP, "").replace(/\s*(?:[✓✔√]{1,3})\s*$/u, "").trim();
    if (!text) {
      drop("message time");
      continue;
    }
    if (TICKS.test(text) && text.length <= 8) {
      drop("receipt");
      continue;
    }
    kept.push({ ...l, text });
  }

  const keptHeights = kept.map((l) => Math.max(1, l.y1 - l.y0));
  const medKept = median(keptHeights);
  const lines: CleanLine[] = kept.map((l, i) => {
    const h = Math.max(1, l.y1 - l.y0);
    return { ...l, i, h, size: h / medKept, top: (l.y0 + l.y1) / 2 / H };
  });
  const confs = page.lines.map((l) => l.conf).filter((c): c is number => typeof c === "number");
  const trust = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 1;
  return { lines, text: lines.map((l) => l.text).join("\n"), dropped, screenshot, trust };
}

/** Builds a page from plain text, one line per row: used by tests and for text that did not come from a picture. */
export function pageFromText(text: string, opts: { width?: number; height?: number; lineHeight?: number } = {}): OcrPage {
  const rows = text.split("\n").filter((r) => r.trim().length);
  const width = opts.width ?? 1080;
  const lh = opts.lineHeight ?? 40;
  const gap = Math.round(lh * 0.6);
  const height = opts.height ?? Math.max(1600, rows.length * (lh + gap) + 400);
  return {
    width,
    height,
    lines: rows.map((t, i) => ({ text: t, x0: 60, x1: width - 60, y0: 300 + i * (lh + gap), y1: 300 + i * (lh + gap) + lh })),
  };
}
