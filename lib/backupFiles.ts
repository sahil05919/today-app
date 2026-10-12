import { toISO } from "./dates";
import { migrate } from "./backup";
import { armWeeklyBackup, backupFileStatus, listBackupFiles, pruneBackupFiles, readBackupFile, saveBackupFile, shareBackupFile, type BackupFile } from "./nativeBridge";
import { isNative } from "./platform";
import { actions, getData } from "./store";
import type { AppData } from "./types";

/**
 * Weekly backups to a folder that survives uninstalling the app: Documents/TodayBackups/today-YYYY-MM-DD.json.
 * Every Sunday at 21:30 (a native alarm, see android BackupReceiver), and a "Backup now" button. The last 8 are kept.
 * Restore asks first and makes a pre-restore backup, so a wrong file can always be undone.
 */
export const KEEP_WEEKLY = 8;
export const KEEP_PRE_RESTORE = 3;
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
export const backupName = (d: Date) => `today-${toISO(d)}.json`;
export const preRestoreName = (d: Date) => `today-pre-restore-${toISO(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;

/** The whole data as JSON text (the phone-calendar mirror is re-read from the phone, so it is left out). */
export const backupText = (data: AppData) => JSON.stringify({ ...data, calendarEvents: undefined }, null, 2);

/** The most recent Sunday at 21:30 that is not in the future. */
export function previousSunday2130(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 30, 0, 0);
  while (d.getDay() !== 0 || d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

/** The next Sunday at 21:30 after `now`. */
export function nextSunday2130(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 30, 0, 0);
  while (d.getDay() !== 0 || d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** A Sunday 21:30 has come and gone since the last backup (the alarm did not fire: the phone was off, the app was force-stopped). */
export const weeklyOverdue = (lastAt: number | undefined, now: Date) => !lastAt || lastAt < previousSunday2130(now).getTime();

/** "No backup for N days" input: the newest of the file backups and the one recorded in the data. */
export const newestBackup = (fileAt: number | undefined, recorded: number | undefined) => Math.max(fileAt ?? 0, recorded ?? 0) || undefined;

export interface BackupState {
  /** Epoch ms of the last file backup (0 = none yet), how many the app can see, and when the next alarm is due. */
  lastAt: number;
  count: number;
  nextAt: number;
  files: BackupFile[];
}

export async function backupState(now = new Date()): Promise<BackupState> {
  const [s, files] = await Promise.all([backupFileStatus(), listBackupFiles()]);
  const weekly = files.filter((f) => /^today-\d{4}-\d{2}-\d{2}\.json$/.test(f.name));
  return { lastAt: s?.lastAt || (weekly[0]?.modified ?? 0), count: s?.count ?? weekly.length, nextAt: s?.nextAt ?? nextSunday2130(now).getTime(), files: weekly };
}

export type BackupResult = { ok: true; name: string } | { ok: false; error: string };

/** Writes the backup file now (the weekly one for today, overwritten if it exists) and keeps the last 8. */
export async function backupNow(now = new Date()): Promise<BackupResult> {
  if (!isNative()) return { ok: false, error: "Backups to the phone's Documents folder work in the Android app." };
  const name = backupName(now);
  const f = await saveBackupFile(name, backupText(getData()));
  if (!f) return { ok: false, error: "Couldn't write the backup. Is there free space on the phone?" };
  await pruneBackupFiles(KEEP_WEEKLY, "weekly");
  actions.settings({ lastBackupAt: now.getTime() });
  return { ok: true, name };
}

/** The backup file names to delete so only the newest `keep` are left (pure, for the tests and the web fallback). */
export function toDelete(names: string[], keep: number): string[] {
  return names
    .filter((n) => /^today-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse()
    .slice(keep);
}

export type RestoreResult = { ok: true; tasks: number; safety?: string } | { ok: false; error: string };

/** Reads backup text, and tells how many tasks it holds (so the confirm can say what will be replaced) without changing anything. */
export function inspectBackup(text: string): { ok: true; data: AppData } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  try {
    return { ok: true, data: migrate(json) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That doesn't look like a Today backup." };
  }
}

/**
 * Restores from backup text. FIRST a pre-restore backup of what is there now is written (so a wrong file can be undone), then
 * the data is replaced. The caller has already asked for confirmation.
 */
export async function restoreFromText(text: string, now = new Date()): Promise<RestoreResult> {
  const read = inspectBackup(text);
  if (!read.ok) return read;
  let safety: string | undefined;
  if (isNative()) {
    const f = await saveBackupFile(preRestoreName(now), backupText(getData()));
    if (!f) return { ok: false, error: "Couldn't make a safety copy first, so nothing was changed." };
    safety = f.name;
    await pruneBackupFiles(KEEP_PRE_RESTORE, "restore");
  }
  actions.replaceAll({ ...read.data, settings: { ...read.data.settings, lastBackupAt: now.getTime() } });
  return { ok: true, tasks: read.data.tasks.length, safety };
}

export async function readFile(file: BackupFile): Promise<string | null> {
  return readBackupFile(file.uri);
}

/** Opens the Android share sheet for the newest weekly backup (Google Drive, email…). */
export async function shareLatest(): Promise<boolean> {
  const s = await backupState();
  const latest = s.files[0];
  return latest ? shareBackupFile(latest.uri) : false;
}

/**
 * At start: arms the Sunday alarm, and if a Sunday 21:30 passed without a backup (the alarm did not fire), takes one now.
 * Returns the time of the newest file backup, for the self-check.
 */
export async function ensureWeeklyBackup(now = new Date()): Promise<number | undefined> {
  if (!isNative()) return undefined;
  await armWeeklyBackup();
  const s = await backupFileStatus();
  const data = getData();
  const hasData = data.tasks.length > 0 || (data.series?.length ?? 0) > 0 || (data.sessions?.length ?? 0) > 0;
  if (hasData && weeklyOverdue(s?.lastAt, now) && now.getTime() - (s?.lastAt ?? 0) > DAY) {
    const r = await backupNow(now);
    if (r.ok) return now.getTime();
  }
  return s?.lastAt || undefined;
}
