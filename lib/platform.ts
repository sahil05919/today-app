import { Capacitor } from "@capacitor/core";

/** True inside the Android app (Capacitor), false on the web / installed PWA. */
export function isNative(): boolean {
  try {
    return typeof window !== "undefined" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
