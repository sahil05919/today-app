import { findTodayCalendar } from "./calendarNames";
import { rememberCalendar } from "./calendarPick";
import type { CalendarAccess, RawCalendarEvent } from "./calendar";
import { toISO } from "./dates";
import { logError } from "./debugLog";
import { digestEntry } from "./autoLog";
import { captureFor, parseTaskEvent, todaysDigest, type InboxEvent } from "./inbox";
import { askCalendarAccess, askCalendarWriteAccess, calendarAccess, calendarWriteAccess, deletePhoneEvent, listAllCalendars, readCalendarById, readPhoneCalendar, type WritableCalendar } from "./nativeBridge";
import { isNative } from "./platform";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";
import type { InboxCheck } from "./types";

export interface InboxBridge {
  access(): Promise<CalendarAccess>;
  /** Every calendar on the phone (reading needs only the read permission), or null when they cannot be listed. */
  calendars(): Promise<WritableCalendar[] | null>;
  read(calendarId: number, from: number, to: number): Promise<RawCalendarEvent[] | null>;
  /** Events of every calendar: the way in when the Inbox calendar cannot be found by name. */
  readAll?(from: number, to: number): Promise<RawCalendarEvent[] | null>;
  remove(eventId: number): Promise<boolean>;
}
const nativeBridge: InboxBridge = { access: calendarAccess, calendars: listAllCalendars, read: readCalendarById, readAll: (from, to) => readPhoneCalendar(from, to), remove: deletePhoneEvent };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** An all-day event is a UTC midnight (Android's rule); a timed one is a moment in the phone's zone. */
export function dayOf(e: RawCalendarEvent): string {
  if (e.allDay) {
    const d = new Date(e.begin);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return toISO(new Date(e.begin));
}

export interface InboxResult {
  added: number;
  digest: boolean;
  status: InboxCheck["status"] | "unsupported";
  check: InboxCheck;
}

/**
 * Reads "Today – Inbox": every new TASK: event becomes one ordinary task (once: its event id is remembered, then the event is deleted
 * from the Inbox), and today's DIGEST: event is kept for the "Emails that need you" card. Digests are never deleted here.
 *
 * Finding the calendar: the one picked in Settings, else the one named "Today – Inbox" (dashes and case do not matter). Listing the
 * phone's calendars needs only the READ permission. If it still cannot be found (renamed, or the phone would not list it), every calendar
 * is searched for TASK: / DIGEST: events instead, so a task from Gmail is never lost to a naming problem; in that case nothing is deleted.
 * What happened is saved (settings.inboxCheck) and shown in Settings → Calendar.
 */
export async function importInbox(now: Date = new Date(), bridge: InboxBridge = nativeBridge, native: boolean = isNative()): Promise<InboxResult> {
  const check: InboxCheck = { at: now.getTime(), status: "ok", calendar: "missing", found: 0, imported: 0, digests: 0, removeFailed: 0 };
  const done = (status: InboxCheck["status"], digest = false): InboxResult => {
    check.status = status;
    if (native) actions.bookkeeping({ inboxCheck: check });
    return { added: check.imported, digest, status, check };
  };
  if (!native) return { added: 0, digest: false, status: "unsupported", check };
  if ((await bridge.access()) !== "granted") return done("no-permission");

  const list = await bridge.calendars();
  const p = withDefaults(getData().profile);
  let cal: WritableCalendar | { id: number; name?: string; sync?: boolean } | undefined = findTodayCalendar(list, "inbox", p.inboxCalendarId).cal;
  // The phone would not list its calendars, but the Inbox was found before: its id was kept.
  if (!cal && !list && /^\d{1,12}$/.test(p.inboxCalendarId ?? "")) cal = { id: Number(p.inboxCalendarId) };
  if (cal && list && "account" in cal) rememberCalendar("inbox", cal);

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const from = start - 30 * DAY;
  const to = start + 120 * DAY;
  let raw: RawCalendarEvent[] | null;
  if (cal) {
    check.calendar = "found";
    check.calendarName = cal.name;
    check.synced = cal.sync;
    raw = await bridge.read(cal.id, from, to);
  } else {
    check.calendar = "scanned";
    raw = (await bridge.readAll?.(from, to)) ?? null;
  }
  if (!raw) return done("error");

  const today = toISO(now);
  const events: InboxEvent[] = raw.filter((e) => e.eventId != null).map((e) => ({ eventId: e.eventId!, title: e.title, description: e.description, date: dayOf(e) }));

  // --- TASK: events, each exactly once ---
  for (const ev of events) {
    const t = parseTaskEvent(ev, getData());
    if (!t) continue;
    check.found++;
    const id = String(t.eventId);
    const d = getData();
    if (!(d.settings.inboxSeen ?? []).includes(id)) {
      try {
        const made = actions.addTask(captureFor(t, d, now));
        // Listed in "What the app did", with where it came from (lib/autoLog.ts).
        actions.logAuto([{ src: t.src, kind: "added", key: `task:${made.id}`, title: made.title, date: made.due }]);
        // Remembered in the same breath as the task is made (saved together), so a retry can never import it twice.
        actions.bookkeeping({ inboxSeen: [...(getData().settings.inboxSeen ?? []), id].slice(-1000) });
        check.imported++;
      } catch (e) {
        logError("inbox:import", e);
        continue;
      }
    }
    // Imported (now or before): take it out of the Inbox. If that fails it stays seen and is simply tried again next time.
    // (Found by searching every calendar, it is left where it is: it may not be in the Inbox at all.)
    if (check.calendar === "found" && !(await bridge.remove(t.eventId))) check.removeFailed++;
  }
  if (check.removeFailed) logError("inbox:delete", `could not remove ${check.removeFailed} imported event(s) from Today – Inbox (deleting needs the calendar write permission)`);
  if (check.imported) {
    const prev = getData().settings.inboxAdded;
    actions.settings({ inboxAdded: { n: Math.min(99, (prev?.n ?? 0) + check.imported), at: now.getTime() } });
  }

  // --- DIGEST: today's only ---
  const digest = todaysDigest(events, today);
  check.digests = events.filter((e) => /^\s*digest:/i.test(e.title)).length;
  const cur = getData().settings.digest;
  if (JSON.stringify(digest ?? null) !== JSON.stringify(cur ?? null)) actions.settings({ digest: digest ?? undefined });
  const listed = digestEntry(getData());
  if (listed) {
    actions.logAuto([listed]);
    actions.bookkeeping({ digestLogged: listed.key.slice("digest:".length) });
  }
  return done("ok", !!digest);
}

/**
 * Settings → Calendar → "Check Gmail inbox now". Asks for the read permission if it was never asked, and for the write permission
 * (needed only to delete imported events from the Inbox) if it is not granted yet. Importing goes ahead whatever is answered.
 */
export async function checkInboxNow(now: Date = new Date()): Promise<InboxResult> {
  if (isNative()) {
    if ((await calendarAccess()) === "prompt") await askCalendarAccess();
    if ((await calendarWriteAccess()) === "prompt") await askCalendarWriteAccess();
  }
  return importInbox(now);
}
