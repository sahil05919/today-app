import { findTodayCalendar } from "./calendarNames";
import { rememberCalendar } from "./calendarPick";
import type { CalendarAccess, RawCalendarEvent } from "./calendar";
import { toISO } from "./dates";
import { logError } from "./debugLog";
import { digestEntry } from "./autoLog";
import { captureFor, parseTaskEvent, todaysDigest, type InboxEvent } from "./inbox";
import { calendarAccess, deletePhoneEvent, listWritableCalendars, readCalendarById, type WritableCalendar } from "./nativeBridge";
import { isNative } from "./platform";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";

export interface InboxBridge {
  access(): Promise<CalendarAccess>;
  calendars(): Promise<WritableCalendar[] | null>;
  read(calendarId: number, from: number, to: number): Promise<RawCalendarEvent[] | null>;
  remove(eventId: number): Promise<boolean>;
}
const nativeBridge: InboxBridge = { access: calendarAccess, calendars: listWritableCalendars, read: readCalendarById, remove: deletePhoneEvent };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** An all-day event is a UTC midnight (Android's rule); a timed one is a moment in the phone's zone. */
function dayOf(e: RawCalendarEvent): string {
  if (e.allDay) {
    const d = new Date(e.begin);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return toISO(new Date(e.begin));
}

export interface InboxResult {
  added: number;
  digest: boolean;
  status: "ok" | "off" | "no-calendar" | "no-permission" | "error" | "unsupported";
}

/**
 * Reads "Today – Inbox": every new TASK: event becomes one ordinary task (once: its event id is remembered, then the event is deleted
 * from the Inbox), and today's DIGEST: event is kept for the "Emails that need you" card. Digests are never deleted here.
 */
export async function importInbox(now: Date = new Date(), bridge: InboxBridge = nativeBridge, native: boolean = isNative()): Promise<InboxResult> {
  if (!native) return { added: 0, digest: false, status: "unsupported" };
  if ((await bridge.access()) !== "granted") return { added: 0, digest: false, status: "no-permission" };
  const list = await bridge.calendars();
  const found = findTodayCalendar(list, "inbox", withDefaults(getData().profile).inboxCalendarId);
  if (!found.cal) return { added: 0, digest: false, status: "no-calendar" };
  rememberCalendar("inbox", found.cal);

  const today = toISO(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const raw = await bridge.read(found.cal.id, start - 30 * DAY, start + 120 * DAY);
  if (!raw) return { added: 0, digest: false, status: "error" };

  const events: InboxEvent[] = raw.filter((e) => e.eventId != null).map((e) => ({ eventId: e.eventId!, title: e.title, description: e.description, date: dayOf(e) }));

  // --- TASK: events, each exactly once ---
  let added = 0;
  for (const ev of events) {
    const t = parseTaskEvent(ev, getData());
    if (!t) continue;
    const id = String(t.eventId);
    const d = getData();
    if (!(d.settings.inboxSeen ?? []).includes(id)) {
      try {
        const made = actions.addTask(captureFor(t, d, now));
        // Listed in "What the app did", with where it came from (lib/autoLog.ts).
        actions.logAuto([{ src: t.src, kind: "added", key: `task:${made.id}`, title: made.title, date: made.due }]);
        // Remembered in the same breath as the task is made (saved together), so a retry can never import it twice.
        actions.bookkeeping({ inboxSeen: [...(getData().settings.inboxSeen ?? []), id].slice(-300) });
        added++;
      } catch (e) {
        logError("inbox:import", e);
        continue;
      }
    }
    // Imported (now or before): take it out of the Inbox. If that fails it stays seen and is simply tried again next time.
    if (!(await bridge.remove(t.eventId))) logError("inbox:delete", `could not remove "${ev.title}" from Today – Inbox`);
  }
  if (added) {
    const prev = getData().settings.inboxAdded;
    actions.settings({ inboxAdded: { n: Math.min(99, (prev?.n ?? 0) + added), at: now.getTime() } });
  }

  // --- DIGEST: today's only ---
  const digest = todaysDigest(events, today);
  const cur = getData().settings.digest;
  if (JSON.stringify(digest ?? null) !== JSON.stringify(cur ?? null)) actions.settings({ digest: digest ?? undefined });
  const listed = digestEntry(getData());
  if (listed) {
    actions.logAuto([listed]);
    actions.bookkeeping({ digestLogged: listed.key.slice("digest:".length) });
  }
  return { added, digest: !!digest, status: "ok" };
}
