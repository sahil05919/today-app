import { compactHistory, historyArchiveName, historyArchiveText } from "./compact";
import { toISO } from "./dates";
import { logError } from "./debugLog";
import { pruneBackupFiles, saveBackupFile } from "./nativeBridge";
import { isNative } from "./platform";
import { actions, getData } from "./store";

export type CompactResult = "skipped" | "nothing" | "done" | "failed";

/** A failed archive write is tried again after this long (not on every sync). */
const RETRY_MS = 6 * 3600_000;
/** How many archive files are kept in Documents/TodayBackups. */
export const KEEP_ARCHIVES = 52;

/**
 * Once a day: raw history older than 8 weeks is written to Documents/TodayBackups/today-history-YYYY-MM-DD.json FIRST, and only
 * when that file is safely written is it removed from the app's data (the weekly snapshots keep the numbers).
 */
export async function runCompaction(now: Date = new Date()): Promise<CompactResult> {
  if (!isNative()) return "skipped";
  const today = toISO(now);
  const d = getData();
  if (d.settings.compactedDate === today) return "skipped";
  if (d.settings.compactFailedAt && now.getTime() - d.settings.compactFailedAt < RETRY_MS) return "skipped";

  const c = compactHistory(d, now);
  if (!c.archived.length) {
    actions.bookkeeping({ compactedDate: today });
    return "nothing";
  }
  const file = await saveBackupFile(historyArchiveName(now), historyArchiveText(c.archived, now));
  if (!file) {
    logError("compact-history", "could not write the history archive file; keeping the history");
    actions.bookkeeping({ compactFailedAt: now.getTime() });
    return "failed";
  }
  // The data may have changed while the file was being written: remove exactly the entries that are now safe in the file.
  const gone = new Set(c.archived.map((e) => e.id));
  const cur = getData();
  // Snapshots made meanwhile are kept; the ones made for the archived weeks are added.
  const haveWeek = new Set((cur.weeks ?? []).map((w) => `${w.week}|${w.kind}`));
  const weeks = [...(cur.weeks ?? []), ...(c.data.weeks ?? []).filter((w) => !haveWeek.has(`${w.week}|${w.kind}`))].sort((a, b) => a.week.localeCompare(b.week)).slice(-60);
  actions.compact(
    (cur.history ?? []).filter((e) => !gone.has(e.id)),
    weeks,
  );
  actions.bookkeeping({ compactedDate: today, compactFailedAt: undefined });
  await pruneBackupFiles(KEEP_ARCHIVES, "history");
  return "done";
}
