import type { ISODate } from "../types";

/**
 * Snap to Today: a photo or screenshot becomes tasks, events or bills. Everything here is shared by the offline reader
 * (lib/snap/extract.ts) and Gemini's answer (lib/snap/gemini.ts): one item shape, so the two can be compared field by field.
 */

/** What the document is. */
export type SnapType = "event" | "appointment" | "bill" | "delivery" | "shift" | "deadline" | "plan" | "note";
export const SNAP_TYPES: SnapType[] = ["event", "appointment", "bill", "delivery", "shift", "deadline", "plan", "note"];

/** What it becomes in the app. */
export type SnapAs = "event" | "task" | "bill" | "note";

export const FIELDS = ["title", "date", "start", "end", "location", "amount", "dueDate", "reference"] as const;
export type FieldName = (typeof FIELDS)[number];

/** One line of OCR text with where it sat in the (scaled) image. */
export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0..1, when the recogniser gave one. */
  conf?: number;
}

/** What the phone's text recogniser saw in one image. */
export interface OcrPage {
  width: number;
  height: number;
  lines: OcrLine[];
  /** When the picture was taken (epoch ms): from its EXIF data, else the file's date. Missing = unknown. */
  takenAt?: number;
  /** Where `takenAt` came from. */
  takenFrom?: "exif" | "file";
}

export interface SnapItem {
  type: SnapType;
  title: string;
  /** When it happens (an event's day, a delivery day, a shift day, a due day for a bill or letter). */
  date?: ISODate;
  /** "HH:mm". */
  start?: string;
  end?: string;
  location?: string;
  /** Pounds. */
  amount?: number;
  /** A deadline that is not the day itself: "pay by", "apply by", "collect by". */
  dueDate?: ISODate;
  /** Booking / order / account / tracking number. */
  reference?: string;
  /** Who it is from: "Eventbrite", "NHS", "Royal Mail"… */
  source?: string;
  /** Other details worth keeping ("Doors 18:30", "Minimum payment £25.00"). */
  notes?: string;
  /** 0..1 for each field that has a value. */
  conf: Partial<Record<FieldName, number>>;
  /** Where each value came from. Missing = the phone. */
  via?: "phone" | "gemini" | "both";
  /** The two readers disagree on the day or the time, or the day is already past: ask. */
  checkDate?: boolean;
  /** What Gemini read for a day or time the phone read differently (shown with the flag). */
  alt?: { date?: ISODate; start?: string; end?: string; dueDate?: ISODate };
}

/** A field below this is highlighted in the review card. */
export const LOW_CONF = 0.6;

/** What reading one image (or a group) produced, before any of it is saved. */
export interface SnapReading {
  docType: SnapType;
  items: SnapItem[];
  /** The cleaned text, with card numbers and the like masked. Kept so a note can still be saved when nothing was found. */
  text: string;
  /** Card numbers, account details, IDs or passwords were seen: nothing about this image goes online. */
  sensitive: boolean;
  /** The text is too short or too unsure to trust: the image itself may go to Gemini (if allowed). */
  weak: boolean;
  /** The cleaned text, unmasked, for the offline reader only. Never stored, never sent when `sensitive`. */
  rawText: string;
}

export const TYPE_LABEL: Record<SnapType, string> = {
  event: "Event",
  appointment: "Appointment",
  bill: "Bill",
  delivery: "Delivery",
  shift: "Shift",
  deadline: "Deadline",
  plan: "Plan",
  note: "Note",
};

/** What each kind of document becomes unless you change it. */
export function defaultAs(type: SnapType, item?: Pick<SnapItem, "start" | "date">): SnapAs {
  switch (type) {
    case "event":
    case "appointment":
      return item?.date ? "event" : "task";
    case "plan":
      // A plan with a day and a time is a fixed commitment; without a time it is a to-do.
      return item?.date && item.start ? "event" : item?.date ? "task" : "note";
    case "bill":
      return "bill";
    case "note":
      return "note";
    default:
      // delivery, shift, deadline
      return "task";
  }
}
