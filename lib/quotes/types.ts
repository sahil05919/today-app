export const MOODS = ["calm", "courage", "discipline", "hope", "self-worth", "gratitude", "focus", "bounce-back"] as const;
export type QuoteMood = (typeof MOODS)[number];

export interface Quote {
  /** Stable: "en1-calm-001". Saved quotes refer to it. */
  id: string;
  text: string;
  /** Only where the attribution is certain. Unsure = no author. */
  author?: string;
  mood: QuoteMood;
}

/** A file's worth of quotes by mood. A plain string is unattributed; [text, author] carries an author. */
export type QuoteRows = Partial<Record<QuoteMood, Array<string | [string, string]>>>;

/** Turns a rows object into quotes with stable ids ("<prefix>-<mood>-<n>"). */
export function build(prefix: string, rows: QuoteRows): Quote[] {
  const out: Quote[] = [];
  for (const mood of MOODS) {
    (rows[mood] ?? []).forEach((r, i) => {
      const [text, author] = typeof r === "string" ? [r, undefined] : r;
      out.push({ id: `${prefix}-${mood}-${String(i + 1).padStart(3, "0")}`, text, author, mood });
    });
  }
  return out;
}
