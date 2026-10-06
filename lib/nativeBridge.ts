import { registerPlugin } from "@capacitor/core";
import { isNative } from "./platform";

export interface LaunchIntent {
  kind: "share" | "new" | "voice";
  text?: string;
  title?: string;
}

interface TodayNativePlugin {
  consumeLaunchIntent(): Promise<{ intent?: LaunchIntent }>;
  batteryStatus(): Promise<{ ignoring: boolean }>;
  openBatterySettings(): Promise<void>;
  addListener(event: "launchIntent", fn: (i: LaunchIntent) => void): Promise<{ remove: () => void }>;
}

/** Our own small Android plugin (android/.../TodayNativePlugin.java). Only exists in the app. */
const TodayNative = registerPlugin<TodayNativePlugin>("TodayNative");

/** Calls `onIntent` for a share/shortcut that opened the app, now and whenever a new one arrives. */
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
