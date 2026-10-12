import type { TodayCalendar } from "./calendarNames";
import type { WritableCalendar } from "./nativeBridge";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";

/**
 * Remembers which phone calendar is "Today – Plan" / "Today – Inbox" once the app has found it by name, so the choice shows in
 * Settings → Calendar and survives a renamed or duplicated calendar. If the calendar is deleted and made again (new id), the next
 * name search finds the new one and this saves it.
 */
export function rememberCalendar(which: TodayCalendar, cal: Pick<WritableCalendar, "id">) {
  const id = String(cal.id);
  if (!/^\d{1,12}$/.test(id)) return;
  const p = withDefaults(getData().profile);
  const key = which === "plan" ? "planCalendarId" : "inboxCalendarId";
  if (p[key] === id) return;
  actions.setProfile({ ...p, [key]: id });
}
