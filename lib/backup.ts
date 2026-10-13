import { isISO, toISO } from "./dates";
import { downloadText } from "./ics";
import { withDefaults } from "./profile";
import { annotateHistory } from "./catHistory";
import { backfillHistory, MAX_HISTORY } from "./history";
import { upgradeRecurring } from "./series";
import { cleanupData } from "./cleanup";
import type {
  AppData,
  AreaTarget,
  AutoEntry,
  Bill,
  BoredIdea,
  CheckInAnswer,
  CheckResult,
  SideWorkState,
  CheckInStatus,
  CoachLetter,
  DayEntry,
  BlockOverride,
  EventMark,
  FixedEvent,
  GroceryItem,
  HistoryEvent,
  InboxCheck,
  LearnedRule,
  UserWord,
  MonthGoals,
  Occurrence,
  Profile,
  QuoteState,
  Recurrence,
  Series,
  SessionLog,
  Step,
  Task,
  TaskOrigin,
  TemplateId,
  WeekSnapshot,
} from "./types";

export const BACKUP_EVERY_DAYS = 14;
const DAY = 86_400_000;

export function emptyData(now = Date.now()): AppData {
  return { version: 5, tasks: [], settings: { firstRunAt: now } };
}

export function backupDue(data: AppData, now = Date.now()): boolean {
  const s = data.settings;
  if (s.backupSnoozedUntil && s.backupSnoozedUntil > now) return false;
  if (data.tasks.length === 0) return false;
  const since = s.lastBackupAt ?? s.firstRunAt;
  return now - since >= BACKUP_EVERY_DAYS * DAY;
}

export function exportBackup(data: AppData) {
  // The phone-calendar mirror is re-read from the phone, so it isn't worth carrying in a backup.
  downloadText(`today-backup-${toISO(new Date())}.json`, JSON.stringify({ ...data, calendarEvents: undefined }, null, 2), "application/json");
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
    nth: Number.isInteger(v.nth) && ((v.nth >= 1 && v.nth <= 4) || v.nth === -1) && weekdays.length ? v.nth : undefined,
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
    hideUntil: isISO(v.hideUntil) ? v.hideUntil : undefined,
    remindAt: num(v.remindAt),
    alarmAck: num(v.alarmAck),
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
    countsFor: str(v.countsFor, 40),
    sessionLogId: str(v.sessionLogId, 64),
    generated: v.generated === true ? true : undefined,
    origin: cleanOrigin(v.origin),
    src: SOURCES.includes(v.src) ? v.src : undefined,
    catHow: CAT_HOWS.includes(v.catHow) ? v.catHow : undefined,
  };
}

function cleanOrigin(v: any): TaskOrigin | undefined {
  if (!v || typeof v !== "object" || !["session", "chore", "bill"].includes(v.kind) || typeof v.key !== "string" || !isISO(v.date)) return undefined;
  return {
    kind: v.kind,
    key: v.key.slice(0, 100),
    date: v.date,
    areaId: str(v.areaId, 40),
    choreId: str(v.choreId, 40),
    billId: str(v.billId, 40),
    due: isISO(v.due) ? v.due : undefined,
    carried: v.carried === true ? true : undefined,
    prevLastDone: isISO(v.prevLastDone) ? v.prevLastDone : undefined,
  };
}

function cleanSeries(v: any): Series[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Series[] = [];
  for (const x of v.slice(0, 500)) {
    const rule = cleanRecur(x?.rule);
    if (!x || typeof x.id !== "string" || !str(x.title) || !rule || !isISO(x.startDate)) continue;
    out.push({
      id: x.id.slice(0, 64),
      title: x.title.slice(0, 300),
      notes: str(x.notes, 5000),
      time: hhmmOf(x.time),
      estimateMin: num(x.estimateMin),
      area: str(x.area, 40),
      tags: Array.isArray(x.tags) ? x.tags.filter((t: unknown) => typeof t === "string").slice(0, 20) : [],
      important: !!x.important,
      steps: Array.isArray(x.steps) ? x.steps.map(cleanStep).filter((t: Step | null): t is Step => !!t) : [],
      template: TEMPLATES.includes(x.template) ? x.template : undefined,
      countsFor: str(x.countsFor, 40),
      lifeId: str(x.lifeId, 40),
      off: x.off === true ? true : undefined,
      rule,
      startDate: x.startDate,
      anchor: isISO(x.anchor) ? x.anchor : undefined,
      until: isISO(x.until) ? x.until : undefined,
      createdAt: num(x.createdAt) ?? Date.now(),
    });
  }
  return out;
}

const SUB_LABELS = ["Building", "Chores", "Admin", "Learning", "Other"];
const CONFIDENCES = ["high", "medium", "low"];
const CAT_HOWS = ["explicit", "inherited", "learned", "dictionary", "gemini", "fallback"];
const SOURCES = ["me", "gmail-star", "gmail-task", "gmail-shift", "gmail-interview", "gmail-bill", "gmail-booking", "gmail-digest", "phone-calendar", "planner-move", "planner-pull", "life-admin", "recurring"];

function cleanInboxCheck(v: any): InboxCheck | undefined {
  if (!v || typeof v !== "object" || !Number.isFinite(v.at) || !["ok", "no-permission", "error"].includes(v.status) || !["found", "scanned", "missing"].includes(v.calendar)) return undefined;
  const n = (x: unknown) => (Number.isFinite(x) && (x as number) >= 0 ? Math.min(9999, Math.round(x as number)) : 0);
  return { at: v.at, status: v.status, calendar: v.calendar, calendarName: str(v.calendarName, 80), synced: typeof v.synced === "boolean" ? v.synced : undefined, found: n(v.found), imported: n(v.imported), digests: n(v.digests), removeFailed: n(v.removeFailed) };
}

function cleanPicks(v: any): AppData["catPicks"] {
  if (!v || typeof v !== "object") return undefined;
  const out: NonNullable<AppData["catPicks"]> = {};
  for (const [k, p] of Object.entries(v).slice(-2000) as Array<[string, any]>) {
    if (k.length > 140 || !p || typeof p.area !== "string") continue;
    out[k] = { area: p.area.slice(0, 40), sub: SUB_LABELS.includes(p.sub) ? p.sub : undefined, at: num(p.at) ?? Date.now() };
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanCatCache(v: any): AppData["catCache"] {
  if (!v || typeof v !== "object") return undefined;
  const out: NonNullable<AppData["catCache"]> = {};
  for (const [k, p] of Object.entries(v).slice(-1500) as Array<[string, any]>) {
    if (k.length > 140 || !p || typeof p.area !== "string") continue;
    out[k] = { area: p.area.slice(0, 40), sub: SUB_LABELS.includes(p.sub) ? p.sub : "Other", at: num(p.at) ?? Date.now() };
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanAuto(v: any): AutoEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const day = (d: any) => (d && isISO(d.date) ? { date: d.date as string, time: hhmmOf(d.time) } : undefined);
  return v
    .filter((e: any) => e && typeof e.key === "string" && typeof e.title === "string" && SOURCES.includes(e.src) && ["added", "moved", "pulled"].includes(e.kind))
    .slice(-500)
    .map((e: any) => ({
      id: str(e.id, 64) || crypto.randomUUID(),
      at: num(e.at) ?? Date.now(),
      src: e.src,
      kind: e.kind,
      key: e.key.slice(0, 140),
      title: e.title.slice(0, 200),
      date: isISO(e.date) ? e.date : undefined,
      from: day(e.from),
      to: day(e.to),
      group: str(e.group, 64),
      reviewed: e.reviewed === true,
      removed: e.removed === true ? true : undefined,
    }));
}
const HIST_KINDS = ["done", "skipped", "missed", "rescheduled", "reopened", "pulled", "cleared"];
const HIST_TYPES = ["session", "task", "event", "bill", "routine"];

function cleanHistory(v: any): HistoryEvent[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((e: any) => e && typeof e.key === "string" && isISO(e.date) && HIST_KINDS.includes(e.kind) && HIST_TYPES.includes(e.type) && typeof e.title === "string")
    .slice(-20000)
    .map((e: any) => ({
      id: str(e.id, 64) || crypto.randomUUID(),
      at: num(e.at) ?? Date.now(),
      date: e.date,
      kind: e.kind,
      type: e.type,
      key: e.key.slice(0, 120),
      title: e.title.slice(0, 200),
      area: str(e.area, 40),
      createdByMe: e.createdByMe === true,
      to: e.to && isISO(e.to.date) ? { date: e.to.date, time: hhmmOf(e.to.time) } : undefined,
      cat: e.cat && typeof e.cat.area === "string" && SUB_LABELS.includes(e.cat.sub) && CONFIDENCES.includes(e.cat.conf) ? { area: e.cat.area.slice(0, 40), sub: e.cat.sub, conf: e.cat.conf } : undefined,
      src: SOURCES.includes(e.src) ? e.src : undefined,
    }));
}

function cleanBlocks(v: any): Record<string, BlockOverride> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, BlockOverride> = {};
  for (const [k, b] of Object.entries(v).slice(-400) as Array<[string, any]>) {
    if (!/@\d{4}-\d{2}-\d{2}$/.test(k) || k.length > 60 || !b || typeof b !== "object") continue;
    const start = Number.isFinite(b.start) && b.start >= 0 && b.start < 1440 ? Math.round(b.start) : undefined;
    const min = Number.isFinite(b.min) && b.min >= 0 && b.min <= 1440 ? Math.round(b.min) : undefined;
    const skip = b.skip === true ? true : undefined;
    if (start !== undefined || min !== undefined || skip) out[k] = { start, min, skip };
  }
  return out;
}

function cleanEventMarks(v: any): Record<string, EventMark> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, EventMark> = {};
  for (const [k, m] of Object.entries(v).slice(-2000) as Array<[string, any]>) {
    if (!/@\d{4}-\d{2}-\d{2}$/.test(k) || k.length > 140 || !m || typeof m !== "object") continue;
    const mark: EventMark = { done: num(m.done), hidden: m.hidden === true ? true : undefined, start: hhmmOf(m.start), end: hhmmOf(m.end) };
    if (mark.done || mark.hidden || mark.start || mark.end) out[k] = mark;
  }
  return out;
}

function cleanWeeks(v: any): WeekSnapshot[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((w: any) => w && isISO(w.week) && ["week-so-far", "your-week"].includes(w.kind) && Array.isArray(w.areas))
    .slice(-60)
    .map((w: any) => ({
      week: w.week,
      at: num(w.at) ?? Date.now(),
      kind: w.kind,
      areas: w.areas
        .filter((a: any) => a && typeof a.id === "string")
        .slice(0, 30)
        .map((a: any) => ({ id: a.id.slice(0, 40), name: String(a.name ?? a.id).slice(0, 40), emoji: String(a.emoji ?? "•").slice(0, 8), done: Number.isFinite(a.done) ? Math.max(0, Math.round(a.done)) : 0, target: Number.isFinite(a.target) ? Math.max(0, Math.round(a.target)) : 0 })),
      own: { added: Number.isFinite(w.own?.added) ? w.own.added : 0, finished: Number.isFinite(w.own?.finished) ? w.own.finished : 0, names: Array.isArray(w.own?.names) ? w.own.names.filter((x: unknown) => typeof x === "string").slice(0, 40).map((x: string) => x.slice(0, 80)) : [] },
      events: { handled: Number.isFinite(w.events?.handled) ? w.events.handled : 0, names: Array.isArray(w.events?.names) ? w.events.names.filter((x: unknown) => typeof x === "string").slice(0, 40).map((x: string) => x.slice(0, 80)) : [] },
      focus: Array.isArray(w.focus) ? w.focus.filter((x: unknown) => typeof x === "string").slice(0, 4) : [],
      text: String(w.text ?? "").slice(0, 3000),
      other: Number.isFinite(w.other?.minutes) ? { minutes: Math.max(0, Math.round(w.other.minutes)), target: Number.isFinite(w.other.target) ? Math.max(0, Math.round(w.other.target)) : 0 } : undefined,
    }));
}

function cleanOccurrences(v: any): Occurrence[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  for (const r of v.slice(-20000)) {
    if (!r || typeof r.seriesId !== "string" || !isISO(r.date)) continue;
    const key = `${r.seriesId.slice(0, 64)}@${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = r.over && typeof r.over === "object" ? r.over : undefined;
    out.push({
      key,
      seriesId: r.seriesId.slice(0, 64),
      date: r.date,
      status: ["done", "skipped", "missed"].includes(r.status) ? r.status : undefined,
      doneAt: num(r.doneAt),
      movedTo: r.movedTo && isISO(r.movedTo.date) ? { date: r.movedTo.date, time: hhmmOf(r.movedTo.time) } : undefined,
      time: typeof r.time === "string" && (r.time === "" || /^\d{2}:\d{2}$/.test(r.time)) ? r.time : undefined,
      extra: r.extra === true ? true : undefined,
      over: o
        ? {
            title: str(o.title, 300),
            notes: str(o.notes, 5000),
            estimateMin: num(o.estimateMin),
            area: str(o.area, 40),
            tags: Array.isArray(o.tags) ? o.tags.filter((t: unknown) => typeof t === "string").slice(0, 20) : undefined,
            important: typeof o.important === "boolean" ? o.important : undefined,
            steps: Array.isArray(o.steps) ? o.steps.map(cleanStep).filter((t: Step | null): t is Step => !!t) : undefined,
          }
        : undefined,
      stepsDone: Array.isArray(r.stepsDone) ? r.stepsDone.filter((x: unknown) => typeof x === "string").slice(0, 100) : undefined,
      sessions: Array.isArray(r.sessions) ? r.sessions.filter((s: any) => s && typeof s.at === "number" && typeof s.min === "number" && s.min > 0).map((s: any) => ({ at: s.at, min: Math.min(s.min, 1440) })) : undefined,
      sessionLogId: str(r.sessionLogId, 64),
      remindAt: num(r.remindAt),
      alarmAck: num(r.alarmAck),
      snoozeCount: Number.isInteger(r.snoozeCount) && r.snoozeCount > 0 ? r.snoozeCount : undefined,
      hideUntil: isISO(r.hideUntil) ? r.hideUntil : undefined,
      focus: r.focus === true ? true : undefined,
      lastCheckIn: r.lastCheckIn && isISO(r.lastCheckIn.date) && STATUSES.includes(r.lastCheckIn.status) ? { date: r.lastCheckIn.date, status: r.lastCheckIn.status } : undefined,
    });
  }
  return out;
}

function cleanSideWork(v: any): SideWorkState | undefined {
  if (!v || typeof v !== "object") return undefined;
  const ids = (x: unknown, max: number) => (Array.isArray(x) ? [...new Set<string>(x.filter((i: unknown) => typeof i === "string" && i.length < 120))].slice(0, max) : []);
  const checks: Record<string, string[]> = {};
  if (v.checks && typeof v.checks === "object") for (const [k, list] of Object.entries(v.checks).slice(-60)) if (isISO(k)) checks[k] = ids(list, 200);
  return {
    weekly: ids(v.weekly, 100),
    hidden: ids(v.hidden, 400),
    custom: Array.isArray(v.custom) ? v.custom.filter((c: any) => c && typeof c.id === "string" && typeof c.name === "string" && c.name.trim()).slice(0, 200).map((c: any) => ({ id: c.id.slice(0, 120), name: c.name.slice(0, 120) })) : [],
    checks,
  };
}

function cleanCheck(v: any): CheckResult | undefined {
  if (!v || typeof v !== "object" || !Number.isFinite(v.at) || !isISO(v.date) || !Array.isArray(v.issues)) return undefined;
  return {
    at: v.at,
    date: v.date,
    issues: v.issues
      .filter((i: any) => i && typeof i.id === "string" && typeof i.text === "string" && ["target", "notification", "orphan", "backup", "mirror"].includes(i.kind))
      .slice(0, 20)
      .map((i: any) => ({ id: i.id.slice(0, 60), kind: i.kind, text: i.text.slice(0, 200), action: ["targets", "lighten", "backup"].includes(i.action) ? i.action : undefined })),
    fixed: Array.isArray(v.fixed) ? v.fixed.filter((x: unknown) => typeof x === "string").slice(0, 20).map((x: string) => x.slice(0, 200)) : [],
  };
}

function cleanTarget(t: any): AreaTarget | undefined {
  if (!t || typeof t !== "object") return undefined;
  const perWeek = Number.isInteger(t.perWeek) ? Math.min(14, Math.max(1, t.perWeek)) : undefined;
  const minutes = Number.isFinite(t.minutes) ? Math.min(480, Math.max(5, Math.round(t.minutes))) : undefined;
  if (!perWeek || !minutes) return undefined;
  return {
    perWeek,
    minutes,
    weekends: !!t.weekends,
    slots: Array.isArray(t.slots) ? t.slots.filter((s: unknown) => typeof s === "string").slice(0, 8) : [],
    at: typeof t.at === "string" && /^\d{2}:\d{2}$/.test(t.at) ? t.at : undefined,
    startAt: Number.isInteger(t.startAt) && t.startAt >= 1 && t.startAt <= 99999 ? t.startAt : undefined,
    variants: Array.isArray(t.variants) ? t.variants.filter((v: unknown) => typeof v === "string" && v).slice(0, 6).map((v: string) => v.slice(0, 30)) : undefined,
    remind: t.remind !== false,
    order: Number.isFinite(t.order) ? t.order : undefined,
    lockSlots: t.lockSlots === true ? true : undefined,
  };
}

function cleanSessions(v: any): SessionLog[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((l: any) => l && typeof l.areaId === "string" && isISO(l.date) && Number.isFinite(l.n) && Number.isFinite(l.minutes))
    .slice(-5000)
    .map((l: any) => ({
      id: str(l.id, 64) || crypto.randomUUID(),
      areaId: l.areaId.slice(0, 40),
      date: l.date,
      minutes: Math.min(1440, Math.max(1, Math.round(l.minutes))),
      n: Math.max(1, Math.round(l.n)),
      variant: str(l.variant, 30),
      at: num(l.at) ?? Date.now(),
      source: l.source === "checkin" ? "checkin" : "manual",
      ...(l.via === "backdated" ? { via: "backdated" as const } : {}),
    }));
}

function cleanLog(v: any): DayEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((e: any) => e && typeof e.key === "string" && ["done", "skip", "snooze", "early", "moved"].includes(e.status))
    .slice(-1000)
    .map((e: any) => ({ key: e.key.slice(0, 80), status: e.status, at: num(e.at) ?? Date.now(), until: num(e.until) }));
}

const hhmmOf = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : undefined);

function cleanEvents(v: any): FixedEvent[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((e: any) => e && typeof e.title === "string" && isISO(e.date))
    .slice(-1000)
    .map((e: any) => ({
      id: str(e.id, 64) || crypto.randomUUID(),
      title: e.title.slice(0, 200),
      date: e.date,
      start: hhmmOf(e.start),
      end: hhmmOf(e.start) ? hhmmOf(e.end) : undefined,
      countsFor: str(e.countsFor, 40),
      createdAt: num(e.createdAt) ?? Date.now(),
      source: e.source === "calendar" || e.source === "ics" ? e.source : undefined,
      calId: str(e.calId, 80),
      area: str(e.area, 40),
      status: str(e.status, 40),
      shift: e.shift === true ? true : undefined,
      remind: e.remind === true ? true : undefined,
      calEventId: str(e.calEventId, 80),
      src: SOURCES.includes(e.src) ? e.src : undefined,
    }));
}

function cleanUserWords(v: any): UserWord[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((w: any) => w && typeof w.word === "string" && w.word.trim() && typeof w.areaId === "string")
    .slice(0, 1000)
    .map((w: any) => ({ word: w.word.trim().toLowerCase().slice(0, 60), areaId: w.areaId.slice(0, 40), at: num(w.at) ?? Date.now() }));
}

function cleanBills(v: any): Bill[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Bill[] = [];
  for (const b of v.slice(0, 60)) {
    if (!b || typeof b.id !== "string" || typeof b.name !== "string" || !b.schedule) continue;
    const s = b.schedule;
    let schedule: Bill["schedule"] | undefined;
    if (s.type === "monthly" && Number.isInteger(s.day) && s.day >= 1 && s.day <= 31) schedule = { type: "monthly", day: s.day };
    else if (s.type === "weekly" && Number.isInteger(s.dow) && s.dow >= 0 && s.dow <= 6) schedule = { type: "weekly", dow: s.dow };
    else if (s.type === "every" && Number.isInteger(s.days) && s.days >= 1 && s.days <= 365) schedule = { type: "every", days: s.days };
    if (!schedule) continue;
    out.push({
      id: b.id.slice(0, 40),
      name: b.name.slice(0, 60),
      kind: b.kind === "chore" ? "chore" : "bill",
      schedule,
      remindDaysBefore: Array.isArray(b.remindDaysBefore)
        ? [...new Set<number>(b.remindDaysBefore.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 31))].sort((a, c) => c - a)
        : [],
      time: hhmmOf(b.time) ?? "18:00",
      autopay: !!b.autopay,
      enabled: b.enabled !== false,
      note: String(b.note ?? "").slice(0, 200),
      groceries: b.groceries ? true : undefined,
      lastDone: isISO(b.lastDone) ? b.lastDone : undefined,
      startDate: isISO(b.startDate) ? b.startDate : undefined,
    });
  }
  return out;
}

function cleanGrocery(v: any): GroceryItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((g: any) => g && typeof g.name === "string" && g.name.trim())
    .slice(0, 300)
    .map((g: any) => ({ id: str(g.id, 64) || crypto.randomUUID(), name: g.name.slice(0, 80), done: !!g.done, addedAt: num(g.addedAt) ?? Date.now() }));
}

function cleanGoals(v: any): MonthGoals | undefined {
  if (!v || typeof v.month !== "string" || !/^\d{4}-\d{2}$/.test(v.month) || !Array.isArray(v.items)) return undefined;
  return {
    month: v.month,
    items: v.items
      .filter((g: any) => g && typeof g.text === "string" && g.text.trim())
      .slice(0, 12)
      .map((g: any) => ({ id: str(g.id, 64) || crypto.randomUUID(), text: g.text.slice(0, 120), done: !!g.done })),
  };
}

function cleanLearned(v: any): LearnedRule[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((r: any) => r && Array.isArray(r.words) && r.words.length && r.words.every((w: unknown) => typeof w === "string"))
    .slice(0, 200)
    .map((r: any) => ({
      id: str(r.id, 64) || crypto.randomUUID(),
      words: r.words.slice(0, 5).map((w: string) => w.slice(0, 40)),
      areaId: str(r.areaId, 40),
      time: hhmmOf(r.time),
      hits: Number.isInteger(r.hits) && r.hits > 0 ? r.hits : 1,
      at: num(r.at) ?? Date.now(),
      item: str(r.item, 100),
      sub: SUB_LABELS.includes(r.sub) ? r.sub : undefined,
    }));
}

function cleanIdeas(v: any): BoredIdea[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((i: any) => i && typeof i.text === "string" && i.text.trim())
    .slice(0, 100)
    .map((i: any) => ({ id: str(i.id, 64) || crypto.randomUUID(), text: i.text.slice(0, 120), areaId: str(i.areaId, 40) }));
}

function cleanCheckins(v: any): CheckInAnswer[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((c: any) => c && isISO(c.date) && ["low", "ok", "high"].includes(c.energy))
    .slice(-120)
    .map((c: any) => ({
      date: c.date,
      energy: c.energy,
      ticked: Number.isInteger(c.ticked) && c.ticked >= 0 ? Math.min(c.ticked, 99) : 0,
      offered: Number.isInteger(c.offered) && c.offered >= 0 ? Math.min(c.offered, 99) : 0,
      at: num(c.at) ?? Date.now(),
    }));
}

function cleanQuotes(v: any): QuoteState | undefined {
  if (!v || typeof v !== "object" || !Number.isInteger(v.seed)) return undefined;
  const assigned: Record<string, number> = {};
  if (v.assigned && typeof v.assigned === "object") {
    for (const [d, n] of Object.entries(v.assigned).slice(-400)) if (isISO(d) && Number.isInteger(n) && (n as number) >= 0) assigned[d] = n as number;
  }
  return {
    seed: v.seed,
    cursor: Number.isInteger(v.cursor) && v.cursor >= 0 ? v.cursor : 0,
    assigned,
    saved: Array.isArray(v.saved) ? [...new Set<string>(v.saved.filter((x: unknown) => typeof x === "string" && x.length < 20))].slice(0, 2000) : [],
    anchor: isISO(v.anchor) ? v.anchor : undefined,
  };
}

function cleanLetters(v: any): CoachLetter[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((l: any) => l && isISO(l.week) && typeof l.text === "string" && l.text.trim())
    .slice(-12)
    .map((l: any) => ({ week: l.week, text: l.text.slice(0, 1500), source: l.source === "ai" ? ("ai" as const) : ("rules" as const), at: num(l.at) ?? Date.now() }));
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
      morningWeekend: hhmm(p.morningWeekend),
      quoteEvery: [0, 1, 2, 3].includes(p.quoteEvery) ? p.quoteEvery : undefined,
      quoteTime: hhmm(p.quoteTime),
      quoteFrom: hhmm(p.quoteFrom),
      quoteTo: hhmm(p.quoteTo),
      briefTime: hhmm(p.briefTime),
      checkinTime: hhmm(p.checkinTime),
      taskCheckIn: hhmm(p.taskCheckIn),
      eveningWrap: hhmm(p.eveningWrap),
      areas: Array.isArray(p.areas)
        ? p.areas
            .filter((a: any) => a && typeof a.id === "string" && typeof a.name === "string")
            .slice(0, 40)
            .map((a: any) => ({
              id: a.id.slice(0, 40),
              name: a.name.slice(0, 30),
              emoji: String(a.emoji ?? "•").slice(0, 8),
              isWork: !!a.isWork || undefined,
              balance: !!a.balance || undefined,
              target: cleanTarget(a.target),
            }))
        : undefined,
      name: typeof p.name === "string" ? p.name.slice(0, 40) : undefined,
      eventLeadMin: n(p.eventLeadMin, 0, 1440),
      nudgeTime: hhmm(p.nudgeTime),
      reviewTime: hhmm(p.reviewTime),
      fridayReviewTime: hhmm(p.fridayReviewTime),
      breakStart: hhmm(p.breakStart),
      breakEnd: hhmm(p.breakEnd),
      bufferMin: n(p.bufferMin, 0, 60),
      eveningCapMin: n(p.eveningCapMin, 30, 480),
      officeCommuteMin: n(p.officeCommuteMin, 0, 240),
      sleepStart: hhmm(p.sleepStart),
      wakeTime: hhmm(p.wakeTime),
      hideMic: bool(p.hideMic),
      calendarSync: bool(p.calendarSync),
      calendarWrite: bool(p.calendarWrite),
      writeCalendarId: typeof p.writeCalendarId === "string" && /^\d{1,12}$/.test(p.writeCalendarId) ? p.writeCalendarId : undefined,
      planMirror: bool(p.planMirror),
      earliestAuto: hhmm(p.earliestAuto),
      otherHours: n(p.otherHours, 0, 40),
      capacityItems: n(p.capacityItems, 0, 20),
      wakeLeadMin: n(p.wakeLeadMin, 0, 600),
      learnAreas: Array.isArray(p.learnAreas) ? p.learnAreas.filter((x: unknown) => typeof x === "string").slice(0, 20).map((x: string) => x.slice(0, 40)) : undefined,
      shareWeek: bool(p.shareWeek),
      buddyName: typeof p.buddyName === "string" ? p.buddyName.trim().slice(0, 40) || undefined : undefined,
      planCalendarId: typeof p.planCalendarId === "string" && /^\d{1,12}$/.test(p.planCalendarId) ? p.planCalendarId : undefined,
      inboxCalendarId: typeof p.inboxCalendarId === "string" && /^\d{1,12}$/.test(p.inboxCalendarId) ? p.inboxCalendarId : undefined,
      officeDays: days(p.officeDays),
      slots: Array.isArray(p.slots)
        ? p.slots
            .filter((s: any) => s && typeof s.id === "string" && hhmm(s.start) && hhmm(s.end))
            .slice(0, 12)
            .map((s: any) => ({ id: s.id.slice(0, 30), name: String(s.name ?? s.id).slice(0, 30), start: s.start, end: s.end, days: days(s.days) ?? [0, 1, 2, 3, 4, 5, 6] }))
        : undefined,
      rhythm: Array.isArray(p.rhythm)
        ? p.rhythm
            .filter((r: any) => r && typeof r.id === "string" && hhmm(r.time))
            .slice(0, 30)
            .map((r: any) => ({
              id: r.id.slice(0, 30),
              label: String(r.label ?? r.id).slice(0, 40),
              time: r.time,
              days: days(r.days) ?? [0, 1, 2, 3, 4, 5, 6],
              enabled: r.enabled !== false,
              message: String(r.message ?? "").slice(0, 200),
              kind: r.kind === "chore" ? "chore" : "nudge",
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
              events: bool(p.notify.events),
              bills: bool(p.notify.bills),
              nudges: bool(p.notify.nudges),
              review: bool(p.notify.review),
              weekSoFar: bool(p.notify.weekSoFar),
              quote: bool(p.notify.quote),
              tonight: bool(p.notify.tonight),
              sessionNudges: bool(p.notify.sessionNudges),
              dayDone: bool(p.notify.dayDone),
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
  const out: AppData = {
    version: 5,
    series: cleanSeries(r.series),
    catPicks: cleanPicks(r.catPicks),
    catCache: cleanCatCache(r.catCache),
    auto: cleanAuto(r.auto),
    occurrences: cleanOccurrences(r.occurrences),
    history: cleanHistory(r.history),
    sideWork: cleanSideWork(r.sideWork),
    learnings: Array.isArray(r.learnings)
      ? r.learnings
          .filter((l: any) => l && isISO(l.date) && typeof l.text === "string" && l.text.trim() && typeof l.areaId === "string")
          .slice(-500)
          .map((l: any) => ({ id: str(l.id, 64) || crypto.randomUUID(), date: l.date, areaId: l.areaId.slice(0, 40), text: l.text.trim().slice(0, 500), at: num(l.at) ?? Date.now(), usedAt: num(l.usedAt) }))
      : undefined,
    worklog: Array.isArray(r.worklog)
      ? r.worklog
          .filter((w: any) => w && isISO(w.date) && Number.isFinite(w.minutes) && w.minutes > 0 && typeof w.title === "string")
          .slice(-1000)
          .map((w: any) => ({ id: str(w.id, 64) || crypto.randomUUID(), date: w.date, minutes: Math.min(960, Math.round(w.minutes)), title: w.title.slice(0, 80), sub: SUB_LABELS.includes(w.sub) ? w.sub : "Other", at: num(w.at) ?? Date.now() }))
      : undefined,
    workSubs:
      r.workSubs && typeof r.workSubs === "object"
        ? (Object.fromEntries(Object.entries(r.workSubs).filter(([k, v]) => k.length < 120 && SUB_LABELS.includes(v as string)).slice(-500)) as Record<string, any>)
        : undefined,
    cleared: Array.isArray(r.cleared)
      ? r.cleared
          .filter((c: any) => c && isISO(c.date) && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
          .slice(-60)
          .map((c: any) => ({ id: str(c.id, 64) || crypto.randomUUID(), group: str(c.group, 64) || str(c.id, 64) || "g", date: c.date, start: Math.max(0, Math.round(c.start)), end: Math.min(1440, Math.round(c.end)), at: num(c.at) ?? Date.now() }))
      : undefined,
    notes: Array.isArray(r.notes)
      ? r.notes
          .filter((n: any) => n && typeof n.text === "string" && n.text.trim() && isISO(n.date))
          .slice(-300)
          .map((n: any) => ({ id: str(n.id, 64) || crypto.randomUUID(), at: num(n.at) ?? Date.now(), date: n.date, text: n.text.slice(0, 1000) }))
      : undefined,
    blocks: cleanBlocks(r.blocks),
    eventMarks: cleanEventMarks(r.eventMarks),
    weeks: cleanWeeks(r.weeks),
    profile: r.profile && typeof r.profile === "object" ? cleanProfile(r.profile) : undefined,
    sessions: cleanSessions(r.sessions),
    log: cleanLog(r.log),
    events: cleanEvents(r.events),
    calendarEvents: cleanEvents(r.calendarEvents),
    userWords: cleanUserWords(r.userWords),
    bills: cleanBills(r.bills),
    grocery: cleanGrocery(r.grocery),
    goals: cleanGoals(r.goals),
    bored: cleanIdeas(r.bored),
    learned: cleanLearned(r.learned),
    checkins: cleanCheckins(r.checkins),
    quotes: cleanQuotes(r.quotes),
    letters: cleanLetters(r.letters),
    offDays: Array.isArray(r.offDays) ? [...new Set<string>(r.offDays.filter((d: unknown) => isISO(d)))].slice(-120) : undefined,
    tasks: r.tasks.map(cleanTask).filter((t: Task | null): t is Task => !!t),
    settings: {
      firstRunAt: num(s.firstRunAt) ?? Date.now(),
      lastCheckInDate: isISO(s.lastCheckInDate) ? s.lastCheckInDate : undefined,
      lastBackupAt: num(s.lastBackupAt),
      backupSnoozedUntil: num(s.backupSnoozedUntil),
      timer:
        s.timer && typeof s.timer.startedAt === "number" && (typeof s.timer.taskId === "string" || typeof s.timer.ref === "string")
          ? {
              taskId: str(s.timer.taskId, 64),
              ref: str(s.timer.ref, 80),
              label: str(s.timer.label, 120),
              startedAt: s.timer.startedAt,
              goalMin: num(s.timer.goalMin),
            }
          : undefined,
      catchUpDate: isISO(s.catchUpDate) ? s.catchUpDate : undefined,
      feelingSkipDate: isISO(s.feelingSkipDate) ? s.feelingSkipDate : undefined,
      overloadSkipDate: isISO(s.overloadSkipDate) ? s.overloadSkipDate : undefined,
      slotShifts:
        s.slotShifts && typeof s.slotShifts === "object"
          ? (Object.fromEntries(Object.entries(s.slotShifts).filter(([k, v]) => typeof v === "string" && k.length < 40 && (v as string).length < 40).slice(0, 30)) as Record<string, string>)
          : undefined,
      calendarSyncedAt: num(s.calendarSyncedAt),
      celebrated: Array.isArray(s.celebrated) ? s.celebrated.filter((k: unknown) => typeof k === "string" && k.length < 80).slice(-40) : undefined,
      freed:
        s.freed && typeof s.freed.areaId === "string" && isISO(s.freed.week)
          ? {
              areaId: s.freed.areaId.slice(0, 40),
              week: s.freed.week,
              at: num(s.freed.at) ?? Date.now(),
              slot:
                s.freed.slot && isISO(s.freed.slot.date) && Number.isFinite(s.freed.slot.start) && Number.isFinite(s.freed.slot.end)
                  ? { date: s.freed.slot.date, start: Math.round(s.freed.slot.start), end: Math.round(s.freed.slot.end) }
                  : undefined,
            }
          : undefined,
      snoozes:
        s.snoozes && typeof s.snoozes === "object"
          ? (Object.fromEntries(Object.entries(s.snoozes).filter(([k, v]) => typeof v === "number" && v > 0 && k.length < 90).slice(0, 300)) as Record<string, number>)
          : undefined,
      exactAsked: s.exactAsked === true ? true : undefined,
      openedDate: isISO(s.openedDate) ? s.openedDate : undefined,
      dayDoneDate: isISO(s.dayDoneDate) ? s.dayDoneDate : undefined,
      calmDate: isISO(s.calmDate) ? s.calmDate : undefined,
      lastCheck: cleanCheck(s.lastCheck),
      checkDismissed: isISO(s.checkDismissed) ? s.checkDismissed : undefined,
      inboxSeen: Array.isArray(s.inboxSeen) ? s.inboxSeen.filter((x: unknown) => typeof x === "string" && x.length < 40).slice(-300) : undefined,
      digest:
        s.digest && isISO(s.digest.date) && Array.isArray(s.digest.items)
          ? { date: s.digest.date, title: String(s.digest.title ?? "").slice(0, 120), items: s.digest.items.filter((x: unknown) => typeof x === "string").slice(0, 30).map((x: string) => x.slice(0, 300)) }
          : undefined,
      digestDismissed: str(s.digestDismissed, 120),
      inboxAdded: s.inboxAdded && Number.isFinite(s.inboxAdded.n) && Number.isFinite(s.inboxAdded.at) ? { n: Math.min(99, Math.max(1, Math.round(s.inboxAdded.n))), at: s.inboxAdded.at } : undefined,
      inboxCheck: cleanInboxCheck(s.inboxCheck),
      calSeen: Array.isArray(s.calSeen) ? s.calSeen.filter((x: unknown) => typeof x === "string" && x.length < 100).slice(-1500) : undefined,
      digestLogged: str(s.digestLogged, 120),
      clashDismissed: Array.isArray(s.clashDismissed) ? s.clashDismissed.filter((x: unknown) => typeof x === "string" && x.length < 120).slice(-100) : undefined,
      alarmsSet:
        s.alarmsSet && typeof s.alarmsSet === "object"
          ? (Object.fromEntries(Object.entries(s.alarmsSet).filter(([k, v]) => k.length < 120 && typeof v === "string" && /^\d{2}:\d{2}$/.test(v)).slice(-60)) as Record<string, string>)
          : undefined,
      winJarDismissed: isISO(s.winJarDismissed) ? s.winJarDismissed : undefined,
      compactedDate: isISO(s.compactedDate) ? s.compactedDate : undefined,
      compactFailedAt: num(s.compactFailedAt),
      mirror:
        s.mirror && Number.isFinite(s.mirror.at) && ["ok", "off", "no-calendar", "not-google", "pick-calendar", "no-permission", "error", "unsupported"].includes(s.mirror.status)
          ? { at: s.mirror.at, status: s.mirror.status, calendar: str(s.mirror.calendar, 80), written: num(s.mirror.written) }
          : undefined,
      shortDismissed: s.shortDismissed && isISO(s.shortDismissed.week) && Array.isArray(s.shortDismissed.areas) ? { week: s.shortDismissed.week, areas: s.shortDismissed.areas.filter((a: unknown) => typeof a === "string").slice(0, 20) } : undefined,
      sofarWeek: isISO(s.sofarWeek) ? s.sofarWeek : undefined,
      focus: s.focus && isISO(s.focus.week) && Array.isArray(s.focus.areas) ? { week: s.focus.week, areas: s.focus.areas.filter((a: unknown) => typeof a === "string").slice(0, 4) } : undefined,
      planDate: isISO(s.planDate) ? s.planDate : undefined,
      wrapDate: isISO(s.wrapDate) ? s.wrapDate : undefined,
      reviewWeek: isISO(s.reviewWeek) ? s.reviewWeek : undefined,
      balanceWeek: isISO(s.balanceWeek) ? s.balanceWeek : undefined,
      seeded: Number.isInteger(s.seeded) ? s.seeded : undefined,
      hiddenEvents: Array.isArray(s.hiddenEvents) ? s.hiddenEvents.filter((x: unknown) => typeof x === "string").slice(0, 200) : undefined,
    },
  };
  // Repeats used to be "finishing one creates the next". They are series now (lossless, and a no-op once converted).
  let upgraded = upgradeRecurring(out);
  if (((r.version ?? 1) as number) < 2) {
    // The weekly review's history starts from what the older data already holds for this week.
    if (!upgraded.history) upgraded = { ...upgraded, history: backfillHistory(upgraded) };
    // The Sunday review used to default to 18:30; the new default for both reviews is 21:00. A changed time is left alone.
    if (upgraded.profile && upgraded.profile.reviewTime === "18:30") upgraded = { ...upgraded, profile: { ...upgraded.profile, reviewTime: "21:00" } };
  }
  // v5: every history entry carries its category (the built-in words only, never the network). Idempotent: an entry that already has one is left alone.
  if (upgraded.history?.length) {
    const h = annotateHistory(upgraded.history, upgraded);
    if (h !== upgraded.history) upgraded = { ...upgraded, history: h };
  }
  // v3: a repeat that exists twice (an old copy, a migration that ran twice) is one repeat; a typed command is not a task.
  return cleanupData(upgraded);
}

/** The schema version this build writes. */
export const SCHEMA_VERSION = 5;

/** True for data saved by an older build: the raw copy must be backed up first (see lib/store.ts). */
export function needsUpgrade(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && Array.isArray((raw as any).tasks) && ((raw as any).version ?? 1) < SCHEMA_VERSION;
}

/** Which backup keys the raw data of an older build must be copied to before it is migrated. */
export function backupKeysFor(raw: unknown, keys: { v2: string; v3: string; v4: string; v5: string }): string[] {
  const v = (raw && typeof raw === "object" ? ((raw as any).version ?? 1) : 1) as number;
  return [...(v < 2 ? [keys.v2] : []), ...(v < 3 ? [keys.v3] : []), ...(v < 4 ? [keys.v4] : []), ...(v < 5 ? [keys.v5] : [])];
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
