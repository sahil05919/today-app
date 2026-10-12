import { isNative } from "./platform";
import { getStatus, pendingIds } from "./notifications/native";
import { requestSync } from "./syncPipeline";
import { newestBackup } from "./backupFiles";
import { backupFileStatus } from "./nativeBridge";
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
  // The newest backup is the newer of the weekly file in Documents/TodayBackups and the one recorded in the data.
  const file = (await backupFileStatus())?.lastAt;
  const lastBackupAt = newestBackup(file, getData().settings.lastBackupAt);
  const out = runSelfCheck(getData(), now, { pendingIds: ids, notificationsOff: off, lastBackupAt });
  actions.recordCheck(out.data, out.result);
  // Reminders that were missing are put back by the next sync run (never directly from here).
  if (out.reschedule) requestSync("manual", { force: true });
  return out.result;
}
