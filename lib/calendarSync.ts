import { askCalendarAccess, calendarAccess, listWritableCalendars, readPhoneCalendar } from "./nativeBridge";
import { MIRROR_NOTE, todayCalendarIds } from "./calendarNames";
import { withoutOwnEvents } from "./calendarWrite";
import { calendarAsked, convertCalendarEvents, markCalendarAsked, syncWindow } from "./calendar";
import { isNative } from "./platform";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";
import type { RawCalendarEvent } from "./calendar";
import type { FixedEvent } from "./types";

export type SyncResult = "ok" | "off" | "no-permission" | "error" | "unsupported";

/** What matters for "did anything change": the events without bookkeeping fields. */
const sig = (list: FixedEvent[] | undefined) => (list ?? []).map((e) => `${e.id}|${e.title}|${e.date}|${e.start ?? ""}|${e.end ?? ""}|${e.remind ? 1 : 0}`).join("\n");

/**
 * Today's own calendars must never be read back as events (the Plan mirror would duplicate the whole schedule, and the Inbox holds
 * TASK: / DIGEST: notes, not appointments). They are left out by calendar id; as a second line of defence, anything that carries the
 * mirror's note, or looks like an add-on note, is dropped even when the calendar list could not be read.
 */
export function withoutTodayCalendars<T extends Pick<RawCalendarEvent, "calendarId" | "title" | "description">>(raw: T[], ownIds: number[]): T[] {
  const own = new Set(ownIds);
  return raw.filter((e) => !(e.calendarId != null && own.has(e.calendarId)) && !e.description?.includes(MIRROR_NOTE) && !/^(TASK|DIGEST):\s/.test(e.title ?? ""));
}

/**
 * Copies the phone's calendar into the app (read-only). Quiet when nothing changed, so it never causes needless rescheduling.
 * `ask`: show Android's permission dialog if it hasn't been shown yet ("ask permission once").
 */
export async function syncPhoneCalendar(opts: { ask?: boolean } = {}): Promise<SyncResult> {
  if (!isNative()) return "unsupported";
  const d = getData();
  if (!withDefaults(d.profile).calendarSync) {
    if (d.calendarEvents?.length) actions.setCalendarEvents([]);
    return "off";
  }
  let access = await calendarAccess();
  if (access === "prompt" && opts.ask && !calendarAsked()) {
    markCalendarAsked();
    access = await askCalendarAccess();
  }
  if (access !== "granted") return "no-permission";
  const { from, to } = syncWindow();
  // Today – Plan / Today – Inbox are found by name and excluded from the read.
  const ownIds = todayCalendarIds(await listWritableCalendars());
  const read = await readPhoneCalendar(from, to, ownIds);
  if (!read) return "error";
  const raw = withoutTodayCalendars(read, ownIds);
  // The events Today wrote to the calendar itself are already in Today: reading them back must not show them twice.
  const events = convertCalendarEvents(withoutOwnEvents(raw, d.events ?? []), 0);
  if (sig(events) !== sig(getData().calendarEvents)) actions.setCalendarEvents(events);
  else actions.calendarChecked();
  return "ok";
}
