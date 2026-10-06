import { isISO, toISO } from "./dates";
import { downloadText } from "./ics";
import { withDefaults } from "./profile";
import type { AppData, CheckInStatus, Profile, Recurrence, Step, Task, TemplateId } from "./types";

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

function cleanRecur(v: any): Recurrence | undefined {
  if (!v || typeof v !== "object" || !["daily", "weekly", "monthly"].includes(v.freq)) return undefined;
  const weekdays = Array.isArray(v.weekdays)
    ? [...new Set<number>(v.weekdays.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6))]
    : [];
  return {
    freq: v.freq,
    interval: Number.isInteger(v.interval) && v.interval > 0 && v.interval <= 365 ? v.interval : 1,
    weekdays: weekdays.length ? weekdays : undefined,
    monthDay: Number.isInteger(v.monthDay) && v.monthDay >= 1 && v.monthDay <= 31 ? v.monthDay : undefined,
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
    recur: cleanRecur(v.recur),
    area: str(v.area, 40),
    remindAt: num(v.remindAt),
    slot:
      v.slot && isISO(v.slot.date) && /^\d{2}:\d{2}$/.test(v.slot.start) && typeof v.slot.min === "number"
        ? { date: v.slot.date, start: v.slot.start, min: Math.min(1440, Math.max(5, v.slot.min)) }
        : undefined,
    nextId: str(v.nextId, 64),
    snoozeCount: Number.isInteger(v.snoozeCount) && v.snoozeCount > 0 ? v.snoozeCount : undefined,
    sessions: Array.isArray(v.sessions)
      ? v.sessions
          .filter((s: any) => s && typeof s.at === "number" && typeof s.min === "number" && s.min > 0)
          .map((s: any) => ({ at: s.at, min: Math.min(s.min, 1440) }))
      : undefined,
    focus: !!v.focus && v.status !== "done",
    status: v.status === "done" ? "done" : "open",
    createdAt: num(v.createdAt) ?? Date.now(),
    completedAt: num(v.completedAt),
    lastCheckIn: lc && isISO(lc.date) && STATUSES.includes(lc.status) ? { date: lc.date, status: lc.status } : undefined,
  };
}

/** Keeps only known, well-formed profile fields; anything missing falls back to the defaults. */
function cleanProfile(p: any): Profile {
  const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
  const days = (v: unknown) =>
    Array.isArray(v) ? [...new Set<number>(v.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))] : undefined;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && v >= lo && v <= hi ? Math.round(v) : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  return withDefaults(
    strip({
      setupDone: bool(p.setupDone),
      workDays: days(p.workDays),
      workStart: hhmm(p.workStart),
      workEnd: hhmm(p.workEnd),
      lunchStart: hhmm(p.lunchStart),
      lunchMin: n(p.lunchMin, 0, 240),
      commuteToMin: n(p.commuteToMin, 0, 240),
      commuteFromMin: n(p.commuteFromMin, 0, 240),
      bestFocus: ["morning", "afternoon", "evening"].includes(p.bestFocus) ? p.bestFocus : undefined,
      gymDays: days(p.gymDays),
      gymStart: hhmm(p.gymStart),
      gymMin: n(p.gymMin, 0, 240),
      quietStart: hhmm(p.quietStart),
      quietEnd: hhmm(p.quietEnd),
      morningCheckIn: hhmm(p.morningCheckIn),
      taskCheckIn: hhmm(p.taskCheckIn),
      eveningWrap: hhmm(p.eveningWrap),
      areas: Array.isArray(p.areas)
        ? p.areas
            .filter((a: any) => a && typeof a.id === "string" && typeof a.name === "string")
            .slice(0, 20)
            .map((a: any) => ({
              id: a.id.slice(0, 40),
              name: a.name.slice(0, 30),
              emoji: String(a.emoji ?? "•").slice(0, 8),
              isWork: !!a.isWork || undefined,
              balance: !!a.balance || undefined,
            }))
        : undefined,
      shortcuts: Array.isArray(p.shortcuts)
        ? p.shortcuts
            .filter((s: any) => s && typeof s.phrase === "string" && hhmm(s.time))
            .slice(0, 50)
            .map((s: any) => ({ phrase: s.phrase.slice(0, 60), time: s.time }))
        : undefined,
      notify:
        p.notify && typeof p.notify === "object"
          ? (strip({
              morning: bool(p.notify.morning),
              taskCheckIns: bool(p.notify.taskCheckIns),
              wrap: bool(p.notify.wrap),
              reminders: bool(p.notify.reminders),
              slots: bool(p.notify.slots),
            }) as Profile["notify"])
          : undefined,
    }),
  );
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
    profile: r.profile && typeof r.profile === "object" ? cleanProfile(r.profile) : undefined,
    tasks: r.tasks.map(cleanTask).filter((t: Task | null): t is Task => !!t),
    settings: {
      firstRunAt: num(s.firstRunAt) ?? Date.now(),
      lastCheckInDate: isISO(s.lastCheckInDate) ? s.lastCheckInDate : undefined,
      lastBackupAt: num(s.lastBackupAt),
      backupSnoozedUntil: num(s.backupSnoozedUntil),
      timer:
        s.timer && typeof s.timer.taskId === "string" && typeof s.timer.startedAt === "number"
          ? { taskId: s.timer.taskId, startedAt: s.timer.startedAt }
          : undefined,
      planDate: isISO(s.planDate) ? s.planDate : undefined,
      wrapDate: isISO(s.wrapDate) ? s.wrapDate : undefined,
      reviewWeek: isISO(s.reviewWeek) ? s.reviewWeek : undefined,
      balanceWeek: isISO(s.balanceWeek) ? s.balanceWeek : undefined,
      hiddenEvents: Array.isArray(s.hiddenEvents) ? s.hiddenEvents.filter((x: unknown) => typeof x === "string").slice(0, 200) : undefined,
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
