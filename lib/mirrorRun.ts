import { findTodayCalendar, MIRROR_NOTE } from "./calendarNames";
import { addDays, toISO } from "./dates";
import { logError } from "./debugLog";
import { buildMirrorEntries, diffMirror, oldestOpenDay, PLAN_DAYS } from "./mirror";
import {
  armDailyMirror,
  calendarWriteAccess,
  deletePhoneEvent,
  listWritableCalendars,
  mirrorApply,
  mirrorState,
  readCalendarById,
  type MirrorEntry,
  type MirrorOp,
  type MirrorResult,
  type MirrorState,
  type WritableCalendar,
} from "./nativeBridge";
import type { CalendarAccess, RawCalendarEvent } from "./calendar";
import { isNative } from "./platform";
import { withDefaults } from "./profile";
import { actions, getData } from "./store";
import type { AppData } from "./types";

export type MirrorStatus = "ok" | "off" | "no-calendar" | "not-google" | "no-permission" | "error" | "unsupported";

export interface MirrorBridge {
  access(): Promise<CalendarAccess>;
  calendars(): Promise<WritableCalendar[] | null>;
  state(): Promise<MirrorState | null>;
  apply(calendarId: number, ops: MirrorOp[], plan: MirrorEntry[]): Promise<MirrorResult | null>;
  read(calendarId: number, from: number, to: number): Promise<RawCalendarEvent[] | null>;
  remove(eventId: number): Promise<boolean>;
}

const nativeBridge: MirrorBridge = { access: calendarWriteAccess, calendars: listWritableCalendars, state: mirrorState, apply: mirrorApply, read: readCalendarById, remove: deletePhoneEvent };

export interface MirrorOutcome {
  status: MirrorStatus;
  /** Calendar writes made by this run (0 when nothing changed). */
  written: number;
  calendar?: WritableCalendar;
}

let lastPlanSig = "";

/** When the map has been lost (a reinstall), events the app wrote earlier are still in the calendar: clear THEIR future ones first, so nothing doubles. */
async function clearStrayFuture(bridge: MirrorBridge, cal: WritableCalendar, today: string): Promise<number> {
  const from = new Date(today + "T00:00:00").getTime();
  const raw = await bridge.read(cal.id, from, from + 30 * 86_400_000);
  let n = 0;
  for (const e of (raw ?? []).filter((x) => x.description?.includes(MIRROR_NOTE) && x.eventId != null).slice(0, 300)) {
    if (await bridge.remove(e.eventId!)) n++;
  }
  return n;
}

/** Brings the "Today – Plan" calendar in line with the plan: diff only, never delete-all-and-recreate. */
export async function runMirror(now: Date = new Date(), bridge: MirrorBridge = nativeBridge, native: boolean = isNative(), data: AppData = getData()): Promise<MirrorOutcome> {
  if (!native) return { status: "unsupported", written: 0 };
  const p = withDefaults(data.profile);
  if (!p.planMirror) return { status: "off", written: 0 };
  if ((await bridge.access()) !== "granted") return { status: "no-permission", written: 0 };
  const list = await bridge.calendars();
  if (!list) return { status: "error", written: 0 };
  const found = findTodayCalendar(list, "plan", p.planCalendarId);
  if (!found.cal) return { status: found.why === "not-google" ? "not-google" : "no-calendar", written: 0 };
  const cal = found.cal;

  const st = await bridge.state();
  if (!st) return { status: "error", written: 0, calendar: cal };
  const map = st.calendarId === cal.id ? st.map : {};
  let written = 0;
  const today = toISO(now);
  if (!Object.keys(map).length) written += await clearStrayFuture(bridge, cal, today);

  const from = oldestOpenDay(map, today);
  const days = Math.round((new Date(addDays(today, PLAN_DAYS) + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86_400_000);
  const desired = buildMirrorEntries(data, from, days, now);
  const diff = diffMirror(desired, map, today);
  const planSig = `${cal.id}|${desired.map((e) => e.key + e.sig).join(",")}`;
  if (diff.ops.length || planSig !== lastPlanSig) {
    const r = await bridge.apply(cal.id, diff.ops, desired);
    if (!r) return { status: "error", written, calendar: cal };
    if (r.failed) logError("mirror", `${r.failed} calendar write${r.failed === 1 ? "" : "s"} failed`);
    lastPlanSig = planSig;
    written += r.inserted + r.updated + r.deleted;
  }
  void armDailyMirror();
  return { status: "ok", written, calendar: cal };
}

/** The pipeline step: runs the mirror and records the status for Settings and the Health check (without starting another sync). */
export async function mirrorStep(now: Date = new Date()): Promise<MirrorOutcome> {
  const out = await runMirror(now);
  const prev = getData().settings.mirror;
  const next = { at: now.getTime(), status: out.status, calendar: out.calendar?.name };
  if (!prev || prev.status !== next.status || prev.calendar !== next.calendar || out.written > 0) actions.bookkeeping({ mirror: { ...next, written: out.written || undefined } });
  return out;
}

export function resetMirrorForTests() {
  lastPlanSig = "";
}
