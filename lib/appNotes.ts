import { toISO } from "./dates";
import type { AppNote } from "./types";

/**
 * Feedback for the app itself. Capture text that starts with `app:` (for example "app: walk reminder feels too early") is never a task:
 * it is saved to Settings → App notes with the date, ready to be copied to Claude (or any developer) as a bullet list.
 */
export const APP_NOTE_RE = /^\s*app\s*:\s*(.*)$/is;
export const MAX_NOTES = 300;

/** "app: …" with something after the colon. */
export function isAppNote(text: string): boolean {
  const m = APP_NOTE_RE.exec(text);
  return !!m && m[1].trim().length > 0;
}

/** The note without its `app:` prefix. */
export const appNoteText = (text: string): string => (APP_NOTE_RE.exec(text)?.[1] ?? text).replace(/\s+/g, " ").trim().slice(0, 1000);

export function makeNote(text: string, now: Date = new Date()): AppNote {
  return { id: crypto.randomUUID(), at: now.getTime(), date: toISO(now), text: appNoteText(text) };
}

const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "- 12 Oct 2026: walk reminder feels too early", newest last, ready to paste. */
export function notesAsBullets(notes: AppNote[]): string {
  if (!notes.length) return "No notes about the app yet.";
  return ["Notes about my Today app:", ...notes.map((n) => `- ${pretty(n.date)}: ${n.text}`)].join("\n");
}
