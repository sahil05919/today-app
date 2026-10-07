import { askCalendarAccess, calendarAccess, readPhoneCalendar } from "./nativeBridge";
import { calendarAsked, convertCalendarEvents, markCalendarAsked, syncWindow } from "./calendar";
import { isNative } from "./platform";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";
import type { FixedEvent } from "./types";

export type SyncResult = "ok" | "off" | "no-permission" | "error" | "unsupported";

/** What matters for "did anything change": the events without bookkeeping fields. */
const sig = (list: FixedEvent[] | undefined) => (list ?? []).map((e) => `${e.id}|${e.title}|${e.date}|${e.start ?? ""}|${e.end ?? ""}`).join("\n");

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
  const raw = await readPhoneCalendar(from, to);
  if (!raw) return "error";
  const events = convertCalendarEvents(raw, 0);
  if (sig(events) !== sig(getData().calendarEvents)) actions.setCalendarEvents(events);
  else actions.settings({ calendarSyncedAt: Date.now() });
  return "ok";
}
