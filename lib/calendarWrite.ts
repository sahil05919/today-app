import { askCalendarWriteAccess, calendarWriteAccess, deletePhoneEvent, listWritableCalendars, upsertPhoneEvent, type NativeEvent, type WritableCalendar } from "./nativeBridge";
import type { CalendarAccess } from "./calendar";
import { isNative } from "./platform";
import { withDefaults } from "./profile";
import { actions, getData, onEventChange } from "./store";
import type { FixedEvent } from "./types";

/**
 * Events created in Today (typed "event …", or confirmed from an email) are also written to the phone's calendar, so they reach
 * Google Calendar. The phone's id of each is kept (`calEventId`) so an edit or delete updates the same entry, and reading the
 * calendar back never shows it twice. Routine sessions are NOT written (that would spam the calendar), and ticks, hides and
 * time overrides on phone events stay local.
 */
export type WriteResult = "ok" | "off" | "no-permission" | "unsupported" | "error";

export interface CalendarBridge {
  access(): Promise<CalendarAccess>;
  ask(): Promise<CalendarAccess>;
  calendars(): Promise<WritableCalendar[] | null>;
  upsert(e: NativeEvent & { eventId?: number }): Promise<number | null>;
  remove(eventId: number): Promise<boolean>;
}

const nativeBridge: CalendarBridge = { access: calendarWriteAccess, ask: askCalendarWriteAccess, calendars: listWritableCalendars, upsert: upsertPhoneEvent, remove: deletePhoneEvent };

/** The calendar to write to when none is chosen: the Google account's own calendar, else any Google one, else the first. */
export function pickDefaultCalendar(list: WritableCalendar[]): WritableCalendar | undefined {
  const google = list.filter((c) => c.accountType === "com.google");
  return google.find((c) => c.primary) ?? google[0] ?? list.find((c) => c.primary) ?? list[0];
}

const hm = (s: string) => ({ h: Number(s.slice(0, 2)), m: Number(s.slice(3, 5)) });

/** An event as the Android calendar wants it: epoch ms, all-day events as UTC midnights (Android's rule). */
export function toNativeEvent(e: FixedEvent, calendarId: number): NativeEvent {
  const [y, mo, d] = e.date.split("-").map(Number);
  const head = ["Added by Today", e.status, e.area === "sidework" ? "Side work" : ""].filter(Boolean).join(" · ");
  const note = e.notes ? `${head}\n${e.notes}` : head;
  const place = e.location ? { location: e.location } : {};
  if (!e.start) {
    const start = Date.UTC(y, mo - 1, d);
    return { calendarId, title: e.title, start, end: start + 86_400_000, allDay: true, description: note, ...place };
  }
  const s = hm(e.start);
  const start = new Date(y, mo - 1, d, s.h, s.m).getTime();
  const endAt = e.end ? new Date(y, mo - 1, d, hm(e.end).h, hm(e.end).m).getTime() : 0;
  return { calendarId, title: e.title, start, end: endAt > start ? endAt : start + 60 * 60_000, allDay: false, description: note, ...place };
}

/** Asked for once (Android shows its own dialog); after that it is the person's call in Settings. */
const ASKED = "today:calendar-write-asked";
const asked = () => {
  try {
    return localStorage.getItem(ASKED) === "1";
  } catch {
    return false;
  }
};
const markAsked = () => {
  try {
    localStorage.setItem(ASKED, "1");
  } catch {
    /* ignore */
  }
};

/** Writes (or updates) one of Today's own events in the phone calendar. */
export async function syncEventToCalendar(eventId: string, bridge: CalendarBridge = nativeBridge, native: boolean = isNative()): Promise<WriteResult> {
  if (!native) return "unsupported";
  const d = getData();
  const p = withDefaults(d.profile);
  if (!p.calendarWrite) return "off";
  const e = (d.events ?? []).find((x) => x.id === eventId);
  // Only events made here: an invite opened from a file, or one read from the calendar, is already somebody's.
  if (!e || e.source) return "off";
  let access = await bridge.access();
  if (access === "prompt" && !asked()) {
    markAsked();
    access = await bridge.ask();
  }
  if (access !== "granted") return "no-permission";
  const list = await bridge.calendars();
  if (!list?.length) return "error";
  const cal = list.find((c) => String(c.id) === p.writeCalendarId) ?? pickDefaultCalendar(list)!;
  const id = await bridge.upsert({ ...toNativeEvent(e, cal.id), eventId: e.calEventId ? Number(e.calEventId) : undefined });
  if (id == null) return "error";
  if (String(id) !== e.calEventId) actions.setCalEventId(e.id, String(id));
  return "ok";
}

/** Takes an event Today wrote out of the phone calendar again (it was deleted in Today). */
export async function removeEventFromCalendar(e: FixedEvent, bridge: CalendarBridge = nativeBridge, native: boolean = isNative()): Promise<WriteResult> {
  if (!native || !e.calEventId) return "off";
  if ((await bridge.access()) !== "granted") return "no-permission";
  return (await bridge.remove(Number(e.calEventId))) ? "ok" : "error";
}

/** Called once by the Android shell: from then on every event you add, edit or delete follows into the calendar. */
export function installCalendarWriter() {
  onEventChange((kind, e) => {
    if (kind === "remove") void removeEventFromCalendar(e);
    else void syncEventToCalendar(e.id);
  });
}

/** The events read back from the phone, without the ones Today wrote itself (they are already in Today). */
export function withoutOwnEvents<T extends { eventId?: number }>(raw: T[], own: FixedEvent[]): T[] {
  const ours = new Set(own.map((e) => e.calEventId).filter(Boolean));
  return ours.size ? raw.filter((r) => r.eventId == null || !ours.has(String(r.eventId))) : raw;
}
