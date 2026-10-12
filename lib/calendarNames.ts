import type { WritableCalendar } from "./nativeBridge";

/**
 * Today's two calendars in Google Calendar. Android apps cannot create a Google-synced calendar, so YOU create them once (in Google
 * Calendar on the web) and the app finds them by name among the phone calendars:
 *   "Today – Plan"  : the safety copy of the next 7 days (the app writes it)
 *   "Today – Inbox" : the Gmail add-on writes TASK: and DIGEST: events here (the app reads them)
 */
export const PLAN_NAME = "Today – Plan";
export const INBOX_NAME = "Today – Inbox";

export const PLAN_HELP = "Create a calendar named 'Today – Plan' in Google Calendar (web) to turn on your safety copy.";
export const INBOX_HELP = "Create a calendar named 'Today – Inbox' in Google Calendar (web) so the Gmail add-on can send you tasks.";

/** Dashes, case and spacing do not matter when matching a name ("Today - Plan" is "Today – Plan"). */
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const is = (cal: { name: string }, wanted: string) => normName(cal.name) === normName(wanted);

export type TodayCalendar = "plan" | "inbox";

export interface Found {
  cal?: WritableCalendar;
  /** Why there is none: it does not exist, or it is not in a Google account. */
  why?: "missing" | "not-google";
}

/**
 * The calendar to use: the one picked in Settings if it still exists, else the one with the right name that belongs to a Google
 * account. A calendar of that name in a non-Google account is ignored (it would never reach Google).
 */
export function findTodayCalendar(list: WritableCalendar[] | null | undefined, which: TodayCalendar, chosenId?: string): Found {
  if (!list?.length) return { why: "missing" };
  if (chosenId) {
    const picked = list.find((c) => String(c.id) === chosenId);
    if (picked) return { cal: picked };
  }
  const name = which === "plan" ? PLAN_NAME : INBOX_NAME;
  const named = list.filter((c) => is(c, name));
  const google = named.find((c) => c.accountType === "com.google");
  if (google) return { cal: google };
  return { why: named.length ? "not-google" : "missing" };
}

/** Every calendar that is one of Today's own, in any account: reading the phone's events must skip all of them. */
export function todayCalendarIds(list: WritableCalendar[] | null | undefined): number[] {
  return (list ?? []).filter((c) => is(c, PLAN_NAME) || is(c, INBOX_NAME)).map((c) => c.id);
}

/** The add-on tags events in your MAIN calendar (shifts, bookings) with this in their notes to get reminders and the clash check. */
export const REMIND_TAG = "#today-remind";

/** The line every mirror event ends with. */
export const MIRROR_NOTE = "Managed by the Today app — edits here are overwritten";
