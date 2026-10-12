import { isNative } from "./platform";
import { getStatus, pendingIds, rescheduleAll } from "./notifications/native";
import { runSelfCheck } from "./selfcheck";
import { actions, getData } from "./store";
import type { CheckResult } from "./types";

/** Runs the self-check on the real data (and, on Android, against what is really scheduled), saves it, fixes the reminders. */
export async function runCheck(): Promise<CheckResult> {
  let ids: number[] | undefined;
  let off = false;
  if (isNative()) {
    const st = await getStatus();
    off = st.permission !== "granted";
    if (!off) ids = (await pendingIds()) ?? undefined;
  }
  const now = new Date();
  const out = runSelfCheck(getData(), now, { pendingIds: ids, notificationsOff: off });
  actions.recordCheck(out.data, out.result);
  if (out.reschedule) await rescheduleAll(getData(), { force: true });
  return out.result;
}
