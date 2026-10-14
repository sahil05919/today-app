import { callGemini, getGeminiKey, type Fetcher } from "../ai";
import { toISO } from "../dates";
import { FIELDS, SNAP_TYPES, type SnapItem } from "./types";

/**
 * Step E: Gemini as an improver, never a requirement. It is asked for STRICT JSON in the same item shape the offline reader
 * produces (one response schema), so the answer can be compared with it field by field (lib/snap/merge.ts). The model is whatever
 * Settings picked or the app discovered from Google's own list (lib/ai.ts), never a name written here. Any error, timeout or
 * unreadable answer gives null and the offline result simply stands.
 */
export const SNAP_TIMEOUT_MS = 8000;

const nullable = (type: string) => ({ type, nullable: true });
const confProps = Object.fromEntries(FIELDS.map((f) => [f, { type: "NUMBER", nullable: true }]));

/** The same fields as SnapItem (lib/snap/types.ts), as Gemini's response schema. */
export const SNAP_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: SNAP_TYPES },
          title: { type: "STRING" },
          date: nullable("STRING"),
          start: nullable("STRING"),
          end: nullable("STRING"),
          location: nullable("STRING"),
          amount: nullable("NUMBER"),
          dueDate: nullable("STRING"),
          reference: nullable("STRING"),
          source: nullable("STRING"),
          notes: nullable("STRING"),
          conf: { type: "OBJECT", properties: confProps, nullable: true },
        },
        required: ["type", "title"],
      },
    },
  },
  required: ["items"],
};

export function buildSnapPrompt(ref: Date, now: Date, offline: SnapItem[]): string {
  const hint = offline.length ? `\nA first, on-device reading found: ${JSON.stringify(offline.map(({ type, title, date, start, end, amount, dueDate }) => ({ type, title, date, start, end, amount, dueDate })))}. Check it against the text; correct it only where the text clearly says otherwise.` : "";
  return [
    "You read what is in ONE photo or screenshot (given as text from OCR, or as the picture itself) and list the things the person may want in their day planner: events and tickets, appointments, bills and statements, deliveries, shift offers, letters with a deadline, plans from a chat, or a plain note.",
    `Today is ${toISO(now)}. The picture was taken on ${toISO(ref)}: "tomorrow", "Sat" and "next Friday" count from that day. Everything is UK, London time. Dates are day first (03/11/2026 is 3 November 2026). Times are 24-hour HH:mm.`,
    "Return JSON only, in the schema. One entry per separate event, shift, appointment or bill (a list of shifts is several entries). Fields:",
    '- type: event | appointment | bill | delivery | shift | deadline | plan | note.',
    "- title: short and specific (the event, venue or sender plus what it is), never a bare date, time or price.",
    '- date: the day it happens (YYYY-MM-DD). For a bill or letter this is the day it is due. Use "starts", "date", "doors" and "appointment" dates. Ignore "issued", "printed", "statement date", "order placed", "letter date".',
    '- start / end: HH:mm. Doors and start are different: start is when it begins. A phone status bar clock (like 12:45) is NOT a time.',
    '- dueDate: a separate deadline ("pay by", "apply by", "collect by"). amount: pounds as a number (the amount to pay, or the ticket total). reference: booking, order, account or tracking number. source: who it is from. location: the place. notes: anything else worth keeping, short.',
    "- conf: for every field you fill in, how sure you are, 0 to 1. Use below 0.6 when the text is unclear.",
    "NEVER invent a day, time or amount that is not in the text: leave it null. Never copy a card number, bank account or password into any field. If there is nothing worth adding, return an empty items list." + hint,
  ].join("\n");
}

export interface SnapAskInput {
  text?: string;
  /** base64 JPEG, only when the text was too weak and the person has not turned image sending off. */
  imageBase64?: string;
  ref: Date;
  now: Date;
  offline: SnapItem[];
}

/** Asks Gemini. Resolves the raw JSON it returned (to be validated by lib/snap/merge.ts), or null on any problem. */
export async function askGemini(input: SnapAskInput, opts: { fetcher?: Fetcher; key?: string; model?: string; timeoutMs?: number } = {}): Promise<unknown | null> {
  if (!(opts.key ?? getGeminiKey())) return null;
  try {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (input.imageBase64) parts.push({ inlineData: { mimeType: "image/jpeg", data: input.imageBase64 } });
    if (input.text) parts.push({ text: `Text read from the picture:\n${input.text.slice(0, 6000)}` });
    if (!parts.length) return null;
    const r = await callGemini({ system: buildSnapPrompt(input.ref, input.now, input.offline), user: "", parts, schema: SNAP_SCHEMA }, { timeoutMs: SNAP_TIMEOUT_MS, ...opts });
    return r.ok ? (r.result as unknown) : null;
  } catch {
    return null;
  }
}
