/** Local calendar date, "YYYY-MM-DD". Never a UTC timestamp, so it can't drift across timezones. */
export type ISODate = string;

export type TemplateId = "project" | "trip" | "job" | "admin" | "event";
export type CheckInStatus = "on-track" | "behind" | "stuck";

export interface Step {
  id: string;
  title: string;
  done: boolean;
  estimateMin?: number;
}

export interface Recurrence {
  freq: "daily" | "weekly" | "monthly";
  /** Every N days / weeks / months. */
  interval: number;
  /** weekly only: 0 = Sun … 6 = Sat. Omitted = same weekday as the due date. */
  weekdays?: number[];
  /** monthly only: 1–31 (clamped to month length). Omitted = same day as the due date. */
  monthDay?: number;
}

/** A life area ("Work", "Family"…). Tasks can be tagged with one. */
export interface Area {
  id: string;
  name: string;
  emoji: string;
  /** Pings are allowed during work hours for tasks in this area. */
  isWork?: boolean;
  /** Counts towards the weekly balance nudge ("nothing in Family or Fun"). */
  balance?: boolean;
}

/** Personal phrase → time of day, e.g. "office ke baad" → 18:30. */
export interface Shortcut {
  phrase: string;
  /** "HH:mm" */
  time: string;
}

export interface Profile {
  /** false until the first-run setup has been saved or skipped. */
  setupDone: boolean;
  /** 0 = Sunday … 6 = Saturday */
  workDays: number[];
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchMin: number;
  commuteToMin: number;
  commuteFromMin: number;
  bestFocus: "morning" | "afternoon" | "evening";
  gymDays: number[];
  gymStart: string;
  gymMin: number;
  quietStart: string;
  quietEnd: string;
  morningCheckIn: string;
  taskCheckIn: string;
  eveningWrap: string;
  areas: Area[];
  shortcuts: Shortcut[];
  notify: { morning: boolean; taskCheckIns: boolean; wrap: boolean; reminders: boolean; slots: boolean };
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  due?: ISODate;
  /** "HH:mm" local time, only when the user gave one. */
  dueTime?: string;
  important: boolean;
  tags: string[];
  /** Whole-task estimate. If steps exist, their estimates take over (see lib/estimate.ts). */
  estimateMin?: number;
  steps: Step[];
  template?: TemplateId;
  recur?: Recurrence;
  /** Life area id (see Profile.areas). */
  area?: string;
  /** Where "Plan my day" put it: a time block on that date. */
  slot?: { date: ISODate; start: string; min: number };
  /** How many times the date was pushed later (snooze / reschedule / roll-over). Reset after the nudge. */
  snoozeCount?: number;
  /** "Snooze 2h" from a notification: nudge me again at this time (epoch ms). */
  remindAt?: number;
  /** Focus-timer sessions: when it was logged and how many minutes. */
  sessions?: { at: number; min: number }[];
  /** On a completed recurring task: the occurrence it spawned (removed again if you reopen it). */
  nextId?: string;
  /** Pinned to Today's focus list (max 3 open tasks). */
  focus: boolean;
  status: "open" | "done";
  createdAt: number;
  completedAt?: number;
  lastCheckIn?: { date: ISODate; status: CheckInStatus };
}

export interface Settings {
  firstRunAt: number;
  lastCheckInDate?: ISODate;
  lastBackupAt?: number;
  backupSnoozedUntil?: number;
  /** The running focus timer, if any. Stored so it survives a reload. */
  timer?: { taskId: string; startedAt: number };
  /** Day the morning plan / evening wrap-up were last done or dismissed. */
  planDate?: ISODate;
  wrapDate?: ISODate;
  /** Monday (ISO) of the week whose review was last done or dismissed. */
  reviewWeek?: ISODate;
  /** "eventId:year" the user hid from "Don't miss this". */
  hiddenEvents?: string[];
  /** Monday (ISO) of the week whose balance nudge was dismissed. */
  balanceWeek?: ISODate;
}

export interface AppData {
  /** Bump when the shape changes and add a step in lib/backup.ts `migrate`. */
  version: 1;
  tasks: Task[];
  settings: Settings;
  /** "Me": routines, areas and shortcuts. Missing = defaults (see lib/profile.ts). */
  profile?: Profile;
  // Later: events?: SavedEvent[]  (see lib/events)
}

export const MAX_FOCUS = 3;
