/**
 * The sensitive guard. If the text of a picture holds a card number, a sort code and account number, an IBAN, a National Insurance
 * number, a passport or ID number or a password, NOTHING about that picture goes online: it is read on the phone only, and these
 * values are masked in any text that is shown or stored.
 */
export type SensitiveKind = "card" | "bank" | "iban" | "ni" | "passport" | "id" | "password";
export interface SensitiveHit {
  kind: SensitiveKind;
  index: number;
  length: number;
}

const luhn = (digits: string) => {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

const IBAN_LEN: Record<string, number> = { GB: 22, IE: 22, FR: 27, DE: 22, ES: 24, IT: 27, NL: 18, BE: 16, PT: 25, CH: 21, AT: 20, SE: 24, DK: 18, NO: 15, PL: 28 };

/** Mod-97 check of an IBAN (after moving the first four characters to the end). */
function ibanOk(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const want = IBAN_LEN[s.slice(0, 2)];
  if (want && s.length !== want) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

export function findSensitive(text: string): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  const add = (kind: SensitiveKind, m: RegExpExecArray, offset = 0, len = m[0].length - offset) => hits.push({ kind, index: m.index + offset, length: len });

  // Card numbers: 13-19 digits in groups, and they pass the Luhn check (an order number does not).
  for (const m of text.matchAll(/(?<![\d£.])(?:\d[ -]?){12,18}\d(?![\d])/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) hits.push({ kind: "card", index: m.index!, length: m[0].length });
  }
  // Security codes next to a label.
  for (const m of text.matchAll(/\b(?:cvv2?|cvc2?|security code|card verification)\b\s*[:#-]?\s*(\d{3,4})\b/gi)) hits.push({ kind: "card", index: m.index! + m[0].length - m[1].length, length: m[1].length });

  // A sort code (12-34-56) together with an account number, or a labelled sort code / account number.
  const sort = /\b\d{2}[- ]\d{2}[- ]\d{2}\b/g;
  const acct = /\b\d{8}\b/g;
  const sorts = [...text.matchAll(sort)];
  const accts = [...text.matchAll(acct)];
  const labelledSort = /\bsort\s*code\b/i.test(text);
  if (sorts.length && (accts.length || labelledSort)) {
    for (const m of sorts) add("bank", m);
    if (labelledSort || /\baccount\s*(?:number|no\.?|num)\b/i.test(text)) for (const m of accts) add("bank", m);
  }
  for (const m of text.matchAll(/\baccount\s*(?:number|no\.?|num)\s*[:#-]?\s*(\d{8})\b/gi)) {
    if (labelledSort || sorts.length) hits.push({ kind: "bank", index: m.index! + m[0].length - 8, length: 8 });
  }

  // IBAN, with the check digits.
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){3,8}\b/g)) if (ibanOk(m[0])) add("iban", m);

  // National Insurance number: AB 12 34 56 C.
  for (const m of text.matchAll(/\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g)) add("ni", m);

  // Passport and other ID numbers.
  for (const m of text.matchAll(/\bpassport\s*(?:number|no\.?|num)?\s*[:#-]?\s*([A-Z0-9]{8,9})\b/gi)) if (/\d/.test(m[1])) hits.push({ kind: "passport", index: m.index! + m[0].length - m[1].length, length: m[1].length });
  for (const m of text.matchAll(/\b[A-Z9]{5}\d{6}[A-Z9]{2}\d[A-Z]{2}\b/g)) add("id", m); // UK driving licence
  for (const m of text.matchAll(/\b(?:national\s*id|id\s*(?:card\s*)?(?:number|no\.?)|licen[cs]e\s*(?:number|no\.?))\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]{6,18}[A-Z0-9])\b/gi)) if (/\d/.test(m[1])) hits.push({ kind: "id", index: m.index! + m[0].length - m[1].length, length: m[1].length });

  // Passwords, PINs and one-time codes written next to their label.
  for (const m of text.matchAll(/\b(?:password|passcode|pass\s*word|pin(?:\s*code)?|otp|one[- ]time (?:code|password)|verification code|security code)\b\s*(?:is|:|=|-)?\s*(\S{3,})/gi)) {
    if (/^(?:is|to|for|and|the|will|has|was|your|you)$/i.test(m[1])) continue;
    hits.push({ kind: "password", index: m.index! + m[0].length - m[1].length, length: m[1].length });
  }
  return hits;
}

export const hasSensitive = (text: string) => findSensitive(text).length > 0;

/** The text with every sensitive value replaced by bullets (a card keeps its last four digits). */
export function maskSensitive(text: string): string {
  const hits = findSensitive(text).sort((a, b) => a.index - b.index);
  if (!hits.length) return text;
  let out = "";
  let at = 0;
  for (const h of hits) {
    if (h.index < at) continue; // overlaps one already masked
    out += text.slice(at, h.index);
    const raw = text.slice(h.index, h.index + h.length);
    out += h.kind === "card" ? "•••• " + raw.replace(/\D/g, "").slice(-4) : "••••••";
    at = h.index + h.length;
  }
  return out + text.slice(at);
}
