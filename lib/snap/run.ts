import type { AppData } from "../types";
import { findDuplicate, matchingBill, type Dup } from "./dup";
import { readPage } from "./extract";
import { mergeItems } from "./merge";
import { maskSensitive } from "./sensitive";
import { defaultAs, type OcrPage, type SnapAs, type SnapItem, type SnapReading } from "./types";

/**
 * One run of Snap to Today: every picture is read on the phone one after the other into ONE review list (the first result shows
 * as soon as it is ready), and when there is a network and a key, Gemini improves each reading in the background. Nothing in here
 * saves anything: the review card does, on your tap. Every failure ends in a calm notice or the editable card, and the temp
 * pictures are always released, finished or not.
 */
export interface ReadResult extends OcrPage {
  /** The phone's handle on the prepared picture, to fetch its JPEG for Gemini and to release it. */
  handle?: string;
}

export interface SnapDeps {
  /** Prepares one picture (rotation, size) and reads its text on the phone. Rejects with a readable Error. */
  readImage(uri: string): Promise<ReadResult>;
  /** base64 JPEG of a prepared picture, only when asked. */
  getJpeg(handle: string): Promise<string | null>;
  /** Frees the prepared pictures (and deletes any temp file). Never throws. */
  release(handles: string[]): Promise<void>;
  /** Asks Gemini. null on any problem. */
  ask(input: { text?: string; imageBase64?: string; ref: Date; now: Date; offline: SnapItem[] }): Promise<unknown | null>;
  online(): boolean;
  aiOn(): boolean;
  neverImage(): boolean;
  now(): Date;
}

export interface ReviewItem extends SnapItem {
  id: string;
  /** Which picture it came from. */
  img: number;
  as: SnapAs;
  /** An event on purpose with no time. */
  allDay: boolean;
  status: "pending" | "added" | "discarded";
  dup?: Dup;
  /** What was chosen about a duplicate. */
  dupChoice?: "skip" | "add";
  matchesBill?: string;
  /** Changed by hand: Gemini's later answer never overwrites it. */
  edited: boolean;
}

export interface SnapState {
  phase: "reading" | "ready";
  total: number;
  done: number;
  items: ReviewItem[];
  /** Cleaned text of everything read (sensitive values masked), for "save as a note" when nothing was found. */
  text: string;
  /** Calm one-liners: a picture that could not be read, offline, and so on. */
  notices: string[];
  /** Gemini: not used / working / finished / tried and failed. */
  online: "off" | "asking" | "done" | "failed";
  /** At least one reading was improved by Gemini. */
  improved: boolean;
}

export const emptyState = (total: number): SnapState => ({ phase: "reading", total, done: 0, items: [], text: "", notices: [], online: "off", improved: false });

let seq = 0;
export function toReview(items: SnapItem[], img: number, data: AppData): ReviewItem[] {
  return items.map((it) => {
    const as = defaultAs(it.type, it);
    const dup = findDuplicate(data, it);
    return {
      ...it,
      id: `snap-${Date.now().toString(36)}-${++seq}`,
      img,
      as,
      allDay: false,
      status: "pending",
      dup: dup ?? undefined,
      matchesBill: it.type === "bill" ? matchingBill(data, `${it.title} ${it.source ?? ""}`) : undefined,
      edited: false,
    };
  });
}

/** Why an item cannot be added yet, or null. */
export function blocker(r: ReviewItem): string | null {
  if (r.status !== "pending") return null;
  if (r.dup && !r.dupChoice) return "Already in Today: skip it, or add it anyway";
  if (r.as === "event" && !r.date) return "Pick a date";
  if (r.as === "event" && !r.start && !r.allDay) return "What time? Pick a time, or all day";
  if (!r.title.trim()) return "Give it a title";
  return null;
}

export interface SnapRun {
  cancel(): void;
  /** Resolves when reading and any Gemini help are finished (or cancelled). */
  done: Promise<void>;
}

/**
 * Reads `uris` and reports every change through `onState`. `getData` is read when items are made (the duplicate check).
 * `update` lets the card say that an item has been edited, so a late Gemini answer leaves it alone.
 */
export function startSnap(opts: { uris: string[]; deps: SnapDeps; getData: () => AppData; onState: (fn: (s: SnapState) => SnapState) => void }): SnapRun {
  const { uris, deps, getData, onState } = opts;
  let cancelled = false;
  const handles: string[] = [];
  const texts: string[] = [];
  const pending: Array<Promise<void>> = [];
  const notice = (n: string) => onState((s) => (s.notices.includes(n) ? s : { ...s, notices: [...s.notices, n] }));

  async function enhance(img: number, reading: SnapReading, page: ReadResult, ref: Date) {
    if (!deps.aiOn() || !deps.online()) return;
    // Anything sensitive in the picture: nothing about it goes online.
    if (reading.sensitive) return;
    onState((s) => ({ ...s, online: "asking" }));
    try {
      let imageBase64: string | undefined;
      // The picture itself only when the text is too weak to read, and never if switched off.
      if (reading.weak && !deps.neverImage() && page.handle) imageBase64 = (await deps.getJpeg(page.handle)) ?? undefined;
      const text = reading.rawText.trim().length >= 12 ? reading.rawText : undefined;
      if (!text && !imageBase64) {
        onState((s) => ({ ...s, online: s.online === "asking" ? "off" : s.online }));
        return;
      }
      const offline = reading.items;
      const raw = await deps.ask({ text, imageBase64, ref, now: deps.now(), offline });
      if (cancelled) return;
      const merged = raw ? mergeItems(offline, raw, deps.now()) : null;
      onState((s) => {
        if (!raw) return { ...s, online: "failed" };
        if (!merged || !merged.changed) return { ...s, online: "done" };
        // Replace the items of this picture that are still untouched; keep the ones the person edited, added or discarded.
        const mine = s.items.filter((x) => x.img === img);
        const fresh = toReview(merged.items, img, getData());
        const items: ReviewItem[] = [];
        let used = 0;
        for (const x of s.items) {
          if (x.img !== img) {
            items.push(x);
            continue;
          }
          const k = mine.indexOf(x);
          const next = fresh[k];
          if (x.edited || x.status !== "pending" || !next) items.push(x);
          else {
            used++;
            items.push({ ...next, id: x.id, dupChoice: x.dupChoice });
          }
        }
        // Items only Gemini found.
        for (const extra of fresh.slice(mine.length)) items.push(extra);
        return { ...s, items, online: "done", improved: s.improved || used > 0 || fresh.length > mine.length };
      });
    } catch {
      onState((s) => ({ ...s, online: "failed" }));
    }
  }

  const done = (async () => {
    try {
      for (let i = 0; i < uris.length; i++) {
        if (cancelled) break;
        let page: ReadResult;
        try {
          page = await deps.readImage(uris[i]);
        } catch (e) {
          notice(uris.length > 1 ? `Picture ${i + 1} could not be read${e instanceof Error && e.message ? ` (${e.message})` : ""}.` : (e instanceof Error && e.message) || "That picture could not be read.");
          onState((s) => ({ ...s, done: s.done + 1 }));
          continue;
        }
        if (page.handle) handles.push(page.handle);
        if (cancelled) break;
        const now = deps.now();
        // "Tomorrow" counts from the day the picture was taken, when that is known.
        const ref = page.takenAt && page.takenAt > 0 && page.takenAt <= now.getTime() ? new Date(page.takenAt) : now;
        let reading: SnapReading;
        try {
          reading = readPage(page, { ref, now });
        } catch {
          notice(`Picture ${i + 1} could not be understood.`);
          onState((s) => ({ ...s, done: s.done + 1 }));
          continue;
        }
        if (reading.text.trim()) texts.push(reading.text);
        const items = toReview(reading.items, i, getData());
        onState((s) => ({ ...s, done: s.done + 1, items: [...s.items, ...items], text: texts.map((t) => maskSensitive(t)).join("\n\n") }));
        if (!reading.items.length && !reading.text.trim()) notice(uris.length > 1 ? `No text found in picture ${i + 1}.` : "I couldn't find any text in that picture.");
        if (reading.sensitive) notice("This picture has card, account or ID details, so it was read on this phone only.");
        // Gemini works on it in the background; the offline result is already on screen.
        pending.push(enhance(i, reading, page, ref));
      }
      onState((s) => ({ ...s, phase: "ready" }));
      await Promise.allSettled(pending);
    } finally {
      // Always: the prepared pictures are freed and any temp file is gone, whatever happened.
      await deps.release(handles).catch(() => undefined);
      onState((s) => ({ ...s, phase: "ready", online: s.online === "asking" ? "failed" : s.online }));
    }
  })();

  return {
    cancel() {
      cancelled = true;
      void deps.release(handles).catch(() => undefined);
    },
    done,
  };
}

