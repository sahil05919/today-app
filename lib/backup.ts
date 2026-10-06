import { isISO, toISO } from "./dates";
import { downloadText } from "./ics";
import type { AppData, CheckInStatus, Step, Task, TemplateId } from "./types";

export const BACKUP_EVERY_DAYS = 14;
const DAY = 86_400_000;

export function emptyData(now = Date.now()): AppData {
  return { version: 1, tasks: [], settings: { firstRunAt: now } };
}

export function backupDue(data: AppData, now = Date.now()): boolean {
  const s = data.settings;
  if (s.backupSnoozedUntil && s.backupSnoozedUntil > now) return false;
  if (data.tasks.length === 0) return false;
  const since = s.lastBackupAt ?? s.firstRunAt;
  return now - since >= BACKUP_EVERY_DAYS * DAY;
}

export function exportBackup(data: AppData) {
  downloadText(`today-backup-${toISO(new Date())}.json`, JSON.stringify(data, null, 2), "application/json");
}

const TEMPLATES: TemplateId[] = ["project", "trip", "job", "admin", "event"];
const STATUSES: CheckInStatus[] = ["on-track", "behind", "stuck"];
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : undefined);

/* eslint-disable @typescript-eslint/no-explicit-any */
function cleanStep(v: any): Step | null {
  if (!v || typeof v !== "object" || !str(v.title)) return null;
  return {
    id: str(v.id, 64) || crypto.randomUUID(),
    title: v.title.slice(0, 300),
    done: !!v.done,
    estimateMin: num(v.estimateMin),
  };
}

function cleanTask(v: any): Task | null {
  if (!v || typeof v !== "object" || !str(v.title)) return null;
  const lc = v.lastCheckIn;
  return {
    id: str(v.id, 64) || crypto.randomUUID(),
    title: v.title.slice(0, 300),
    notes: str(v.notes, 5000),
    due: isISO(v.due) ? v.due : undefined,
    dueTime: typeof v.dueTime === "string" && /^\d{2}:\d{2}$/.test(v.dueTime) ? v.dueTime : undefined,
    important: !!v.important,
    tags: Array.isArray(v.tags) ? v.tags.filter((t: unknown) => typeof t === "string").slice(0, 20) : [],
    estimateMin: num(v.estimateMin),
    steps: Array.isArray(v.steps) ? v.steps.map(cleanStep).filter((s: Step | null): s is Step => !!s) : [],
    template: TEMPLATES.includes(v.template) ? v.template : undefined,
    focus: !!v.focus && v.status !== "done",
    status: v.status === "done" ? "done" : "open",
    createdAt: num(v.createdAt) ?? Date.now(),
    completedAt: num(v.completedAt),
    lastCheckIn: lc && isISO(lc.date) && STATUSES.includes(lc.status) ? { date: lc.date, status: lc.status } : undefined,
  };
}

/** Validates + migrates any parsed JSON into AppData. Throws a friendly Error if it isn't ours. */
export function migrate(raw: unknown): AppData {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).tasks)) {
    throw new Error("That doesn't look like a Today backup file.");
  }
  const r = raw as any;
  const s = r.settings ?? {};
  return {
    version: 1,
    tasks: r.tasks.map(cleanTask).filter((t: Task | null): t is Task => !!t),
    settings: {
      firstRunAt: num(s.firstRunAt) ?? Date.now(),
      lastCheckInDate: isISO(s.lastCheckInDate) ? s.lastCheckInDate : undefined,
      lastBackupAt: num(s.lastBackupAt),
      backupSnoozedUntil: num(s.backupSnoozedUntil),
    },
  };
}

export async function readBackupFile(file: File): Promise<AppData> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  return migrate(json);
}
