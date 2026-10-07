import { registerPlugin } from "@capacitor/core";
import type { CalendarAccess, RawCalendarEvent } from "./calendar";
import { isNative } from "./platform";

export interface LaunchIntent {
  kind: "share" | "new" | "voice" | "ics";
  text?: string;
  title?: string;
}

interface TodayNativePlugin {
  consumeLaunchIntent(): Promise<{ intent?: LaunchIntent }>;
  createAlarmChannel(opts: { id: string }): Promise<void>;
  batteryStatus(): Promise<{ ignoring: boolean }>;
  openBatterySettings(): Promise<void>;
  calendarPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  requestCalendarPermission(): Promise<{ state: "granted" | "denied" | "prompt" }>;
  queryCalendar(opts: { from: number; to: number }): Promise<{ events: RawCalendarEvent[] }>;
  vibrate(opts: { ms: number }): Promise<void>;
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
