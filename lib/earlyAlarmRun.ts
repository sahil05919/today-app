import type { AlarmAction } from "./earlyAlarm";
import { setPhoneAlarm } from "./nativeBridge";
import { actions, getData } from "./store";

/**
 * Makes the real Android alarm (the clock app's own, no screen shown) and remembers it, so the button is not offered twice.
 * Returns false when Android could not do it (not the Android app, or no clock app that takes alarms).
 */
export async function setEarlyAlarm(a: AlarmAction): Promise<boolean> {
  const ok = await setPhoneAlarm(a.hour, a.minutes, a.message);
  if (ok) {
    const cur = getData().settings.alarmsSet ?? {};
    actions.settings({ alarmsSet: { ...Object.fromEntries(Object.entries(cur).slice(-59)), [a.key]: a.time } });
  }
  return ok;
}
