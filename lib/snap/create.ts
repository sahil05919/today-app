import { inferArea } from "../areas";
import { friendlyDate, toISO } from "../dates";
import { inferCountsFor } from "../fixed";
import type { ParsedCapture } from "../parse";
import { withDefaults } from "../profile";
import { actions, getData } from "../store";
import { finalize } from "../understand";
import type { AppData, ISODate } from "../types";
import { TYPE_LABEL, type SnapAs, type SnapType } from "./types";

/**
 * What you confirmed, saved the way the app saves anything you type: events through `addFixedEvent` (so the planner moves flexible
 * sessions around them and the phone calendar follows), tasks through `finalize` + `addTask` (so learned fixes, the area guess and
 * the "nothing before 11:00 unless you set it" rule all apply), reminders / widget / backups through the usual sync. Only the
 * extracted details are kept: never the picture, and never a thumbnail.
 */
export interface Draft {
  as: SnapAs;
  type: SnapType;
  title: string;
  date?: ISODate;
  start?: string;
  end?: string;
  /** An event with no time, on purpose. */
  allDay?: boolean;
  location?: string;
  amount?: number;
  dueDate?: ISODate;
  reference?: string;
  source?: string;
  notes?: string;
  /** The recurring bill this looks like (its reminders already exist). */
  matchesBill?: string;
}

export interface Added {
  /** The toast line. */
  summary: string;
  undo: () => void;
}

const money = (n: number) => `£${n.toFixed(2)}`;
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hasArea = (data: AppData, id: string) => withDefaults(data.profile).areas.some((a) => a.id === id);

/** The details that do not have a field of their own, as the lines of a task's notes. */
export function noteLines(d: Draft, skip: { amount?: boolean } = {}): string | undefined {
  const lines = [
    d.source ? `From ${d.source}` : "",
    d.location && d.as !== "event" ? `Where: ${d.location}` : "",
    !skip.amount && d.amount !== undefined && !d.notes?.includes(money(d.amount)) ? `Amount: ${money(d.amount)}` : "",
    d.dueDate && d.dueDate !== d.date ? `Due: ${d.dueDate}` : "",
    d.reference ? `Ref: ${d.reference}` : "",
    d.matchesBill ? `Matches your “${d.matchesBill}” bill: its reminders are already set.` : "",
    d.notes ?? "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}

/** "Pay Council tax bill (£112.40)". */
export function billTitle(d: Pick<Draft, "title" | "amount">): string {
  const named = /^pay\b/i.test(d.title) ? d.title : `Pay ${d.title}`;
  return d.amount !== undefined && !named.includes("£") ? `${named} (${money(d.amount)})` : named;
}

/** The task a draft becomes, in the app's own capture shape. */
export function taskFor(d: Draft, data: AppData, now: Date): ParsedCapture {
  const areas = withDefaults(data.profile).areas;
  const bill = d.as === "bill";
  const title = bill ? billTitle(d) : d.title;
  const due = bill ? (d.dueDate ?? d.date) : d.date;
  const timed = !bill && !!d.start && !d.allDay;
  let area: string | undefined;
  if (d.type === "shift" && hasArea(data, "sidework")) area = "sidework";
  else if (bill) area = ["finance", "life"].find((id) => hasArea(data, id));
  area = area ?? inferArea(title, areas);
  const estimateMin = timed && d.end && minOf(d.end) > minOf(d.start!) ? minOf(d.end) - minOf(d.start!) : undefined;
  const p: ParsedCapture = {
    kind: d.as === "note" ? "note" : "task",
    title,
    due: d.as === "note" ? undefined : due,
    dueTime: timed ? d.start : undefined,
    dueEndTime: timed ? d.end : undefined,
    important: false,
    tags: [],
    estimateMin,
    area: d.as === "note" ? (hasArea(data, "notes") ? "notes" : area) : area,
    areaSource: "guess",
    timeSource: timed ? "typed" : undefined,
    source: "rules",
    notes: noteLines(d, { amount: bill }),
    raw: title,
    src: "snap",
  };
  return d.as === "note" ? p : finalize(p, data, now);
}

/** Saves one confirmed item and returns what to say and how to take it back. */
export function addDraft(d: Draft, now: Date = new Date()): Added {
  const data = getData();
  const profile = withDefaults(data.profile);
  const today = toISO(now);
  if (d.as === "event" && d.date) {
    const timed = !!d.start && !d.allDay;
    const e = actions.addFixedEvent({
      title: d.title.trim() || TYPE_LABEL[d.type],
      date: d.date,
      start: timed ? d.start : undefined,
      end: timed && d.end && minOf(d.end) > minOf(d.start!) ? d.end : undefined,
      countsFor: inferCountsFor(d.title, profile.areas),
      area: d.type === "shift" && hasArea(data, "sidework") ? "sidework" : undefined,
      location: d.location,
      notes: noteLines({ ...d, location: undefined }),
      src: "snap",
    });
    return { summary: `Added: ${e.title}, ${friendlyDate(d.date, today)}${timed ? ` ${d.start}${e.end ? "–" + e.end : ""}` : " (all day)"}`, undo: () => actions.removeEvent(e.id) };
  }
  const p = taskFor(d.as === "event" ? { ...d, as: "task" } : d, data, now);
  const t = actions.addTask(p);
  const when = p.due ? `, ${friendlyDate(p.due, today)}${p.dueTime ? " " + p.dueTime : ""}` : "";
  return { summary: p.kind === "note" ? `Saved note: ${t.title}` : `Added: ${t.title}${when}`, undo: () => actions.undoAdd(t.id) };
}
