import { nativeVibrate } from "./nativeBridge";
import { isNative } from "./platform";

/** Short vibration: native on the phone, the browser's own where supported. Silent no-op elsewhere. */
export function buzz(ms = 12) {
  try {
    if (isNative()) nativeVibrate(ms);
    else navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
