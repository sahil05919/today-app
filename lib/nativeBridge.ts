import { registerPlugin } from "@capacitor/core";
import type { CalendarAccess, RawCalendarEvent } from "./calendar";
import { isNative } from "./platform";
import type { WidgetAction } from "./widget";

export interface LaunchIntent {
  kind: "share" | "new" | "voice" | "ics" | "start";
  text?: string;
  title?: string;
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

interface TodayNativePlugin {
  consumeLaunchIntent(): Promise<{ intent?: LaunchIntent }>;
  createAlarmChannel(opts: { id: string }): Promise<void>;
  batteryStatus(): Promise<{ ignoring: boolean }>;
  openBatterySettings(): Promise<void>;
  calendarPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  requestCalendarPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  queryCalendar(opts: { from: number; to: number }): Promise<{ events: RawCalendarEvent[] }>;
  calendarWritePermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  requestCalendarWritePermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  listCalendars(): Promise<{ calendars: WritableCalendar[] }>;
  upsertCalendarEvent(opts: NativeEvent & { eventId?: number }): Promise<{ eventId: number }>;
  deleteCalendarEvent(opts: { eventId: number }): Promise<void>;
  saveBackup(opts: { name: string; text: string }): Promise<{ name: string; uri: string }>;
  listBackups(): Promise<{ backups: BackupFile[] }>;
  pruneBackups(opts: { keep: number; kind?: "weekly" | "restore" }): Promise<{ deleted: number }>;
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

/** Calls `onIntent` for a share/shortcut/invite that opened the app, now and whenever a new one arrives. */
export function listenForLaunchIntents(onIntent: (i: LaunchIntent) => void): () => void {
  if (!isNative()) return () => {};
  let handle: { remove: () => void } | undefined;
  let gone = false;
  TodayNative.consumeLaunchIntent()
    .then((r) => r.intent && !gone && onIntent(r.intent))
    .catch(() => {});
  TodayNative.addListener("launchIntent", (i) => {
    TodayNative.consumeLaunchIntent().catch(() => {});
    onIntent(i);
  })
    .then((h) => (gone ? h.remove() : (handle = h)))
    .catch(() => {});
  return () => {
    gone = true;
    handle?.remove();
  };
}

/** Creates the alarm-sound notification channel. false when it couldn't be made (older app build, or not Android). */
export async function createAlarmChannel(id: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await TodayNative.createAlarmChannel({ id });
    return true;
  } catch {
    return false;
  }
}

/** true = Android won't kill the app to save battery. null = not applicable (web). */
export async function batteryUnrestricted(): Promise<boolean | null> {
  if (!isNative()) return null;
  try {
    return (await TodayNative.batteryStatus()).ignoring;
  } catch {
    return null;
  }
}

export async function openBatterySettings() {
  if (isNative()) await TodayNative.openBatterySettings().catch(() => {});
}

// ---- Phone calendar (read-only) ------------------------------------------------------------------------

export async function calendarAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  try {
    return (await TodayNative.calendarPermission()).state;
  } catch {
    return "unsupported";
  }
}

/** Android's own permission dialog. Resolves with what you chose. */
export async function askCalendarAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  try {
    return (await TodayNative.requestCalendarPermission()).state;
  } catch {
    return "unsupported";
  }
}

/** Events between two moments, or null when it can't be read (no permission, older app build). */
export async function readPhoneCalendar(from: number, to: number): Promise<RawCalendarEvent[] | null> {
  if (!isNative()) return null;
  try {
    return (await TodayNative.queryCalendar({ from, to })).events;
  } catch {
    return null;
  }
}

// ---- Phone calendar (write) -------------------------------------------------------------------------------

export async function calendarWriteAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  try {
    return (await TodayNative.calendarWritePermission()).state;
  } catch {
    return "unsupported";
  }
}

export async function askCalendarWriteAccess(): Promise<CalendarAccess> {
  if (!isNative()) return "unsupported";
  try {
    return (await TodayNative.requestCalendarWritePermission()).state;
  } catch {
    return "unsupported";
  }
}

/** The calendars Today can write to (null when it cannot be read: no permission, or an older app build). */
export async function listWritableCalendars(): Promise<WritableCalendar[] | null> {
  if (!isNative()) return null;
  try {
    return (await TodayNative.listCalendars()).calendars;
  } catch {
    return null;
  }
}

/** Adds the event, or updates it when its phone id is given. Resolves the phone's id of the event, or null. */
export async function upsertPhoneEvent(e: NativeEvent & { eventId?: number }): Promise<number | null> {
  if (!isNative()) return null;
  try {
    return (await TodayNative.upsertCalendarEvent(e)).eventId;
  } catch {
    return null;
  }
}

export async function deletePhoneEvent(eventId: number): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await TodayNative.deleteCalendarEvent({ eventId });
    return true;
  } catch {
    return false;
  }
}

// ---- Backups (Documents/TodayBackups) ---------------------------------------------------------------------

export async function saveBackupFile(name: string, text: string): Promise<BackupFile | null> {
  if (!isNative()) return null;
  try {
    const r = await TodayNative.saveBackup({ name, text });
    return { name: r.name, uri: r.uri, size: text.length, modified: Date.now() };
  } catch {
    return null;
  }
}

export async function listBackupFiles(): Promise<BackupFile[]> {
  if (!isNative()) return [];
  try {
    return (await TodayNative.listBackups()).backups;
  } catch {
    return [];
  }
}

export async function pruneBackupFiles(keep: number, kind: "weekly" | "restore" = "weekly"): Promise<number> {
  if (!isNative()) return 0;
  try {
    return (await TodayNative.pruneBackups({ keep, kind })).deleted;
  } catch {
    return 0;
  }
}

export async function readBackupFile(uri: string): Promise<string | null> {
  if (!isNative()) return null;
  try {
    return (await TodayNative.readBackup({ uri })).text;
  } catch {
    return null;
  }
}

export async function shareBackupFile(uri: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await TodayNative.shareBackup({ uri });
    return true;
  } catch {
    return false;
  }
}

export async function backupFileStatus(): Promise<{ lastAt: number; count: number; nextAt: number } | null> {
  if (!isNative()) return null;
  try {
    return await TodayNative.backupStatus();
  } catch {
    return null;
  }
}

/** Arms the Sunday 21:30 alarm that writes the weekly backup, even with the app closed. */
export async function armWeeklyBackup(): Promise<number | null> {
  if (!isNative()) return null;
  try {
    return (await TodayNative.scheduleWeeklyBackup()).at;
  } catch {
    return null;
  }
}

// ---- Home-screen widget ---------------------------------------------------------------------------------

/** Saves the widget's snapshot (JSON) and asks Android to redraw it. Fails soft: no widget, no problem. */
export async function pushWidgetSnapshot(snapshot: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await TodayNative.widgetUpdate({ snapshot });
    return true;
  } catch {
    return false;
  }
}

/** Dones tapped on the widget since the app last looked (and clears them). */
export async function takeWidgetActions(): Promise<WidgetAction[]> {
  if (!isNative()) return [];
  try {
    return (await TodayNative.widgetTakePending()).actions ?? [];
  } catch {
    return [];
  }
}

// ---- Small things ---------------------------------------------------------------------------------------

/** A short buzz. Native on Android (the WebView's own vibrate needs a tap first and is unreliable). */
export function nativeVibrate(ms: number) {
  if (isNative()) TodayNative.vibrate({ ms }).catch(() => {});
}

// ---- Recording (for Gemini transcription) --------------------------------------------------------------

export const recorder = {
  async permission(): Promise<"granted" | "denied" | "prompt"> {
    try {
      return (await TodayNative.micPermission()).state;
    } catch {
      return "denied";
    }
  },
  /** Starts recording; asks for the microphone first if needed. Throws a readable Error. */
  async start(maxMs = 60_000) {
    try {
      await TodayNative.startRecording({ maxMs });
    } catch (e) {
      throw new Error(String((e as { message?: string })?.message ?? e));
    }
  },
  async stop() {
    return TodayNative.stopRecording();
  },
  async cancel() {
    await TodayNative.cancelRecording().catch(() => {});
  },
};
