import { registerPlugin } from "@capacitor/core";
import type { CalendarAccess, RawCalendarEvent } from "./calendar";
import { logError } from "./debugLog";
import { safely, withTimeout } from "./nativeGuard";
import { isNative } from "./platform";
import type { WidgetAction } from "./widget";

export interface LaunchIntent {
  kind: "share" | "new" | "voice" | "ics" | "start" | "images";
  text?: string;
  title?: string;
  /** "images" (Share → Today with pictures): the addresses of the pictures. They are opened one at a time, in memory. */
  uris?: string[];
  /** "start" (the widget's Start button): which item to open with its timer running. */
  itemKind?: string;
  ref?: string;
  taskId?: string;
  key?: string;
}

/** A calendar an event can be written to. */
export interface WritableCalendar {
  id: number;
  name: string;
  account: string;
  accountType: string;
  /** The account's own calendar. */
  primary: boolean;
  /** An event can be added to it. (Missing in older builds, which only listed writable calendars.) */
  writable?: boolean;
  /** Shown in the phone's calendar app / syncing its events. */
  visible?: boolean;
  sync?: boolean;
}

/** An event as the Android calendar wants it (epoch ms). */
export interface NativeEvent {
  calendarId: number;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  description?: string;
  location?: string;
}

export interface BackupFile {
  name: string;
  uri: string;
  size: number;
  modified: number;
}

/** One event of the "Today – Plan" mirror, as Android's calendar wants it. */
export interface MirrorEvent {
  title: string;
  /** Epoch ms. All-day events are UTC midnights (Android's rule); `end` is exclusive. */
  start: number;
  end: number;
  allDay: boolean;
  description: string;
}

/** One planned item of the mirror: its key (day + item), the day it belongs to, the event, and a signature of the event's content. */
export interface MirrorEntry {
  key: string;
  day: string;
  sig: string;
  event: MirrorEvent;
}

export interface MirrorOp {
  op: "insert" | "update" | "delete";
  key: string;
  day: string;
  sig: string;
  /** Present on insert and update. */
  event?: MirrorEvent;
  /** The day has ended: this write is the day's final state; the entry is never touched again. */
  final?: boolean;
}

/** What Android remembers about the mirror: which calendar it writes to and the occurrence key → event id map. */
export interface MirrorState {
  calendarId: number | null;
  map: Record<string, { id: number; sig: string; day: string; final?: boolean }>;
}

export interface MirrorResult {
  inserted: number;
  updated: number;
  deleted: number;
  failed: number;
}

interface TodayNativePlugin {
  consumeLaunchIntent(): Promise<{ intent?: LaunchIntent }>;
  createAlarmChannel(opts: { id: string }): Promise<void>;
  batteryStatus(): Promise<{ ignoring: boolean }>;
  openBatterySettings(): Promise<void>;
  calendarPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  requestCalendarPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  queryCalendar(opts: { from: number; to: number; excludeCalendarIds?: number[]; calendarIds?: number[] }): Promise<{ events: RawCalendarEvent[] }>;
  calendarWritePermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  requestCalendarWritePermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  listCalendars(): Promise<{ calendars: WritableCalendar[] }>;
  upsertCalendarEvent(opts: NativeEvent & { eventId?: number }): Promise<{ eventId: number }>;
  deleteCalendarEvent(opts: { eventId: number }): Promise<void>;
  mirrorState(): Promise<MirrorState>;
  mirrorApply(opts: { calendarId: number; ops: MirrorOp[]; plan: MirrorEntry[] }): Promise<MirrorResult>;
  scheduleDailyMirror(): Promise<{ at: number }>;
  snapPick(opts: { source: "camera" | "gallery" }): Promise<{ uris: string[]; cancelled?: boolean }>;
  snapRead(opts: { uri: string }): Promise<SnapPage>;
  snapJpeg(opts: { handle: string }): Promise<{ base64?: string }>;
  snapRelease(opts: { handles: string[] }): Promise<void>;
  setAlarm(opts: { hour: number; minutes: number; message: string }): Promise<void>;
  saveBackup(opts: { name: string; text: string }): Promise<{ name: string; uri: string }>;
  listBackups(): Promise<{ backups: BackupFile[] }>;
  pruneBackups(opts: { keep: number; kind?: "weekly" | "restore" | "history" }): Promise<{ deleted: number }>;
  readBackup(opts: { uri: string }): Promise<{ text: string }>;
  shareBackup(opts: { uri: string }): Promise<void>;
  backupStatus(): Promise<{ lastAt: number; count: number; nextAt: number }>;
  scheduleWeeklyBackup(): Promise<{ at: number }>;
  vibrate(opts: { ms: number }): Promise<void>;
  widgetUpdate(opts: { snapshot: string }): Promise<void>;
  widgetTakePending(): Promise<{ actions: WidgetAction[] }>;
  micPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  startRecording(opts: { maxMs?: number }): Promise<void>;
  stopRecording(): Promise<{ base64: string; mime: string; ms: number }>;
  cancelRecording(): Promise<void>;
  addListener(event: "launchIntent", fn: (i: LaunchIntent) => void): Promise<{ remove: () => void }>;
}

/** Our own small Android plugin (android/.../TodayNativePlugin.java). Only exists in the app. */
const TodayNative = registerPlugin<TodayNativePlugin>("TodayNative");

/**
 * Every call below goes through `safely`: it gets 5 seconds, and a hang or a rejection is logged (Settings → Health → Recent
 * errors) and answered with the fallback, so the screen never waits on the phone.
 */

/** Calls `onIntent` for a share/shortcut/invite that opened the app, now and whenever a new one arrives. */
export function listenForLaunchIntents(onIntent: (i: LaunchIntent) => void): () => void {
  if (!isNative()) return () => {};
  let handle: { remove: () => void } | undefined;
  let gone = false;
  void safely("consumeLaunchIntent", () => TodayNative.consumeLaunchIntent(), {} as { intent?: LaunchIntent }).then((r) => r.intent && !gone && onIntent(r.intent));
  void safely("addListener(launchIntent)", () => TodayNative.addListener("launchIntent", (i) => {
    void safely("consumeLaunchIntent", () => TodayNative.consumeLaunchIntent(), {} as { intent?: LaunchIntent });
    onIntent(i);
  }), null).then((h) => (gone ? h?.remove() : (handle = h ?? undefined)));
  return () => {
    gone = true;
    handle?.remove();
  };
}

/** Creates the alarm-sound notification channel. false when it couldn't be made (older app build, or not Android). */
export async function createAlarmChannel(id: string): Promise<boolean> {
  if (!isNative()) return false;
  return safely("createAlarmChannel", async () => (await TodayNative.createAlarmChannel({ id }), true), false);
}

/** true = Android won't kill the app to save battery. null = not applicable (web). */
export async function batteryUnrestricted(): Promise<boolean | null> {
  if (!isNative()) return null;
  return safely<boolean | null>("batteryStatus", async () => (await TodayNative.batteryStatus()).ignoring, null);
}

export async function openBatterySettings() {
  if (isNative()) await safely("openBatterySettings", () => TodayNative.openBatterySettings(), undefined);
}

// ---- Phone calendar (read-only) ------------------------------------------------------------------------

export async function calendarAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  return safely<CalendarAccess>("calendarPermission", async () => (await TodayNative.calendarPermission()).state, "unsupported");
}

/** Android's own permission dialog. Resolves with what you chose. (The dialog waits for you, so it is given a minute.) */
export async function askCalendarAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  return safely<CalendarAccess>("requestCalendarPermission", async () => (await TodayNative.requestCalendarPermission()).state, "unsupported", 60_000);
}

/**
 * Events between two moments, or null when it can't be read (no permission, older app build).
 * `excludeCalendarIds`: calendars that must not be read (Today's own "Today – Plan" and "Today – Inbox").
 */
export async function readPhoneCalendar(from: number, to: number, excludeCalendarIds?: number[]): Promise<RawCalendarEvent[] | null> {
  if (!isNative()) return null;
  return safely<RawCalendarEvent[] | null>("queryCalendar", async () => (await TodayNative.queryCalendar({ from, to, excludeCalendarIds })).events, null);
}

/** The events of ONE calendar (Today – Inbox, or the Plan mirror), or null when they can't be read. */
export async function readCalendarById(calendarId: number, from: number, to: number): Promise<RawCalendarEvent[] | null> {
  if (!isNative()) return null;
  return safely<RawCalendarEvent[] | null>("queryCalendar(one)", async () => (await TodayNative.queryCalendar({ from, to, calendarIds: [calendarId] })).events, null);
}

// ---- Phone calendar (write) -------------------------------------------------------------------------------

export async function calendarWriteAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  return safely<CalendarAccess>("calendarWritePermission", async () => (await TodayNative.calendarWritePermission()).state, "unsupported");
}

export async function askCalendarWriteAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  return safely<CalendarAccess>("requestCalendarWritePermission", async () => (await TodayNative.requestCalendarWritePermission()).state, "unsupported", 60_000);
}

/** Every calendar on the phone, writable or not (null when it cannot be read: no permission, or an older app build). Needs only read access. */
export async function listAllCalendars(): Promise<WritableCalendar[] | null> {
  if (!isNative()) return null;
  return safely<WritableCalendar[] | null>("listCalendars", async () => (await TodayNative.listCalendars()).calendars, null);
}

/** The calendars Today can write to (null when they cannot be listed). */
export async function listWritableCalendars(): Promise<WritableCalendar[] | null> {
  const all = await listAllCalendars();
  return all ? all.filter((c) => c.writable !== false) : null;
}

/** Adds the event, or updates it when its phone id is given. Resolves the phone's id of the event, or null. */
export async function upsertPhoneEvent(e: NativeEvent & { eventId?: number }): Promise<number | null> {
  if (!isNative()) return null;
  return safely<number | null>("upsertCalendarEvent", async () => (await TodayNative.upsertCalendarEvent(e)).eventId, null);
}

export async function deletePhoneEvent(eventId: number): Promise<boolean> {
  if (!isNative()) return false;
  return safely("deleteCalendarEvent", async () => (await TodayNative.deleteCalendarEvent({ eventId }), true), false);
}

// ---- The "Today – Plan" mirror ---------------------------------------------------------------------------

/** The mirror's event-id map as Android keeps it (null when it cannot be read). */
export async function mirrorState(): Promise<MirrorState | null> {
  if (!isNative()) return null;
  return safely<MirrorState | null>("mirrorState", () => TodayNative.mirrorState(), null);
}

/** Applies a batch of inserts / updates / deletes to the Plan calendar in one native call, and remembers the plan for the 06:00 alarm. */
export async function mirrorApply(calendarId: number, ops: MirrorOp[], plan: MirrorEntry[]): Promise<MirrorResult | null> {
  if (!isNative()) return null;
  // Android needs a real number and a real array. Without a usable calendar id nothing is sent at all.
  if (!Number.isSafeInteger(calendarId) || calendarId < 1 || !Array.isArray(ops)) {
    logError("native:mirrorApply", `not sent: calendarId=${String(calendarId)}`);
    return null;
  }
  return safely<MirrorResult | null>("mirrorApply", () => TodayNative.mirrorApply({ calendarId, ops, plan }), null, 20_000);
}

/** Arms the daily ~06:00 alarm that rolls the mirror forward even when the app is closed. */
export async function armDailyMirror(): Promise<number | null> {
  if (!isNative()) return null;
  return safely<number | null>("scheduleDailyMirror", async () => (await TodayNative.scheduleDailyMirror()).at, null);
}

// ---- Snap to Today (pictures read on the phone) ---------------------------------------------------------------

/** What the phone read in one picture (lib/snap/types.ts `OcrPage`, plus the handle of the prepared picture). */
export interface SnapPage {
  width: number;
  height: number;
  lines: Array<{ text: string; x0: number; y0: number; x1: number; y1: number; conf?: number }>;
  takenAt?: number;
  takenFrom?: "exif" | "file";
  handle?: string;
}

/**
 * Opens the camera or the photo picker. { uris } when pictures were chosen, { cancelled: true } when not, null when it could not be
 * opened (the reason is in Settings → Health → Recent errors). The person is in another app meanwhile, so there is no 5 s limit.
 */
export async function snapPick(source: "camera" | "gallery"): Promise<{ uris: string[]; cancelled?: boolean } | null> {
  if (!isNative()) return null;
  return safely<{ uris: string[]; cancelled?: boolean } | null>("snapPick", () => TodayNative.snapPick({ source }), null, 10 * 60_000);
}

/** Prepares one picture and reads its text on the phone. Throws a readable Error (the card shows it calmly). */
export async function snapRead(uri: string): Promise<SnapPage> {
  if (!isNative()) throw new Error("Reading pictures needs the Android app");
  // The recogniser can fail once on a busy phone and work the next moment: the generic failure gets exactly one more try.
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(TodayNative.snapRead({ uri }), "snapRead", 40_000);
    } catch (e) {
      logError("native:snapRead", e);
      const m = String((e as { message?: string })?.message ?? "");
      if (attempt === 0 && /Could not read the text/.test(m)) continue;
      throw new Error(m && !/did not answer/.test(m) ? m : "Reading that picture took too long");
    }
  }
}

/** The prepared picture as base64 JPEG (for Gemini, only when the text was too weak). */
export async function snapJpeg(handle: string): Promise<string | null> {
  if (!isNative()) return null;
  return safely<string | null>("snapJpeg", async () => (await TodayNative.snapJpeg({ handle })).base64 ?? null, null, 10_000);
}

/** Frees the prepared pictures and removes any temp file. Never throws. */
export async function snapRelease(handles: string[]): Promise<void> {
  if (!isNative()) return;
  await safely("snapRelease", () => TodayNative.snapRelease({ handles }), undefined);
}

// ---- Alarms ---------------------------------------------------------------------------------------------------

/** Creates a real alarm in the phone's clock app (no screen shown). It rings at the next such time of day. false when it could not. */
export async function setPhoneAlarm(hour: number, minutes: number, message: string): Promise<boolean> {
  if (!isNative()) return false;
  if (!Number.isInteger(hour) || !Number.isInteger(minutes) || hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return false;
  return safely("setAlarm", async () => (await TodayNative.setAlarm({ hour, minutes, message }), true), false);
}

// ---- Backups (Documents/TodayBackups) ---------------------------------------------------------------------

export async function saveBackupFile(name: string, text: string): Promise<BackupFile | null> {
  if (!isNative()) return null;
  // A big file, and on Android 7-9 a permission dialog may be waiting for an answer: more than the usual 5 s.
  return safely<BackupFile | null>("saveBackup", async () => {
    const r = await TodayNative.saveBackup({ name, text });
    return { name: r.name, uri: r.uri, size: text.length, modified: Date.now() };
  }, null, 30_000);
}

export async function listBackupFiles(): Promise<BackupFile[]> {
  if (!isNative()) return [];
  return safely<BackupFile[]>("listBackups", async () => (await TodayNative.listBackups()).backups, []);
}

export async function pruneBackupFiles(keep: number, kind: "weekly" | "restore" | "history" = "weekly"): Promise<number> {
  if (!isNative()) return 0;
  return safely("pruneBackups", async () => (await TodayNative.pruneBackups({ keep, kind })).deleted, 0);
}

export async function readBackupFile(uri: string): Promise<string | null> {
  if (!isNative()) return null;
  return safely<string | null>("readBackup", async () => (await TodayNative.readBackup({ uri })).text, null, 15_000);
}

export async function shareBackupFile(uri: string): Promise<boolean> {
  if (!isNative()) return false;
  return safely("shareBackup", async () => (await TodayNative.shareBackup({ uri }), true), false);
}

export async function backupFileStatus(): Promise<{ lastAt: number; count: number; nextAt: number } | null> {
  if (!isNative()) return null;
  return safely<{ lastAt: number; count: number; nextAt: number } | null>("backupStatus", () => TodayNative.backupStatus(), null);
}

/** Arms the Sunday 21:30 alarm that writes the weekly backup, even with the app closed. */
export async function armWeeklyBackup(): Promise<number | null> {
  if (!isNative()) return null;
  return safely<number | null>("scheduleWeeklyBackup", async () => (await TodayNative.scheduleWeeklyBackup()).at, null);
}

// ---- Home-screen widget ---------------------------------------------------------------------------------

/** Saves the widget's snapshot (JSON) and asks Android to redraw it. Fails soft: no widget, no problem. */
export async function pushWidgetSnapshot(snapshot: string): Promise<boolean> {
  if (!isNative()) return false;
  return safely("widgetUpdate", async () => (await TodayNative.widgetUpdate({ snapshot }), true), false);
}

/** Dones tapped on the widget since the app last looked (and clears them). */
export async function takeWidgetActions(): Promise<WidgetAction[]> {
  if (!isNative()) return [];
  return safely<WidgetAction[]>("widgetTakePending", async () => (await TodayNative.widgetTakePending()).actions ?? [], []);
}

// ---- Small things ---------------------------------------------------------------------------------------

/** A short buzz. Native on Android (the WebView's own vibrate needs a tap first and is unreliable). */
export function nativeVibrate(ms: number) {
  if (isNative()) void safely("vibrate", () => TodayNative.vibrate({ ms }), undefined, 2000);
}

// ---- Recording (for Gemini transcription) --------------------------------------------------------------

export const recorder = {
  async permission(): Promise<"granted" | "denied" | "prompt"> {
    return safely<"granted" | "denied" | "prompt">("micPermission", async () => (await TodayNative.micPermission()).state, "denied");
  },
  /** Starts recording; asks for the microphone first if needed. Throws a readable Error. */
  async start(maxMs = 60_000) {
    try {
      // The microphone dialog waits for a tap, so this one is not on the 5 s clock.
      await withTimeout(TodayNative.startRecording({ maxMs }), "startRecording", 60_000);
    } catch (e) {
      throw new Error(String((e as { message?: string })?.message ?? e));
    }
  },
  async stop() {
    return withTimeout(TodayNative.stopRecording(), "stopRecording", 15_000);
  },
  async cancel() {
    await safely("cancelRecording", () => TodayNative.cancelRecording(), undefined);
  },
};
