import { aiEnabled, callGemini, type Fetcher } from "./ai";
import { toISO } from "./dates";
import type { ParsedShare } from "./shareParse";

/**
 * The fallback for an email the phone could not read (no date found). Only used when a Gemini key is set. It sends ONLY the
 * shared text, nothing from the app, and nothing is stored: the answer fills the confirm sheet, which says "Read with Gemini".
 */
const SCHEMA = {
  type: "OBJECT",
  properties: {
    isEvent: { type: "BOOLEAN" },
    title: { type: "STRING" },
    date: { type: "STRING" },
    start: { type: "STRING" },
    end: { type: "STRING" },
    status: { type: "STRING" },
  },
  required: ["isEvent"],
};

const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : undefined);

export async function readWithGemini(text: string, now: Date, opts: { fetcher?: Fetcher; key?: string; model?: string; timeoutMs?: number } = {}): Promise<ParsedShare | null> {
  if (!(opts.key ?? aiEnabled())) return null;
  try {
    const r = await callGemini(
      {
        system:
          "You read one booking, shift or appointment from the text of an email. Today is " +
          toISO(now) +
          " (London). Answer isEvent=false if there is no dated booking. Otherwise give a short title (a line like 'WTM Exhibition shift (Pinnacle) — Standby'), date as YYYY-MM-DD, start and end as HH:mm in London time, and status as written (Approved, Confirmed, Standby…). Never invent a date or time that is not in the text.",
        user: text.slice(0, 6000),
        schema: SCHEMA,
      },
      { timeoutMs: 12_000, ...opts },
    );
    if (!r.ok) return null;
    const a = r.result as unknown as { isEvent?: boolean; title?: string; date?: string; start?: string; end?: string; status?: string };
    if (!a.isEvent || typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return null;
    const title = typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, 120) : "Booking";
    const staffing = /\b(shift|standby|staff|casual|agency)\b/i.test(text);
    return { title, date: a.date, start: hhmm(a.start), end: hhmm(a.start) ? hhmm(a.end) : undefined, status: typeof a.status === "string" && a.status.trim() ? a.status.trim().slice(0, 30) : undefined, area: staffing ? "sidework" : undefined, source: "gemini", shift: staffing };
  } catch {
    return null;
  }
}
