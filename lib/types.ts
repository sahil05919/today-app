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
/** A weekly practice target for an area: "Power BI, 4× a week, 60 min". One unit is a "session". */
export interface AreaTarget {
  perWeek: number;
  minutes: number;
  /** May sessions land on Saturday / Sunday? (Weekends stay light by default.) */
  weekends: boolean;
  /** Preferred time-of-day slots (Profile.slots ids), best first. */
  slots: string[];
  /** Preferred start inside the slot, e.g. the walk at "19:30". */
  at?: string;
  /** Sessions alternate through these names ("Job Prep", "Job Apply"). */
  variants?: string[];
  /** Notify when a planned session starts. */
  remind: boolean;
  /** Placement order inside a slot: lower goes first (Power BI before the walk). */
  order?: number;
}

export interface Area {
  id: string;
  name: string;
  emoji: string;
  /** Pings are allowed during work hours for tasks in this area. */
  isWork?: boolean;
  /** Counts towards the weekly balance nudge ("nothing in Family or Fun"). */
  balance?: boolean;
  /** Set = this area has a weekly session target. */
  target?: AreaTarget;
}

/** A window of the day where sessions can go: "Before work 08:00–09:00". */
export interface Slot {
  id: string;
  name: string;
  start: string;
  end: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
}

/** A timed check-in in the daily rhythm. */
export interface RhythmItem {
  id: string;
  label: string;
  time: string;
  days: number[];
  enabled: boolean;
  /** What the notification says. `{name}` becomes your name. */
  message: string;
  /** "chore" = tracked: asks until you press Done. "nudge" = just a gentle ping. */
  kind: "nudge" | "chore";
}

/** One finished session. The counter ("Power BI session 14") is `n`. */
export interface SessionLog {
  id: string;
  areaId: string;
  date: ISODate;
  minutes: number;
  n: number;
  variant?: string;
  at: number;
  source: "manual" | "checkin";
}

/** What happened to a check-in on a given day (done / skipped / snoozed). */
export interface DayEntry {
  /** "session:<areaId>:<date>", "chore:<id>:<date>" or "wrap:<date>" */
  key: string;
  status: "done" | "skip" | "snooze";
  at: number;
  /** For snooze: when to ask again (epoch ms). */
  until?: number;
}

/** Personal phrase → time of day, e.g. "office ke baad" → 18:30. */
export interface Shortcut {
  phrase: string;
  /** "HH:mm" */
  time: string;
}

/** A fixed block in your calendar ("event Wednesday 6pm dinner"). Sessions flow around it. */
export interface FixedEvent {
  id: string;
  title: string;
  date: ISODate;
  /** "HH:mm". Omitted = all day (that day's sessions move elsewhere). */
  start?: string;
  end?: string;
  /** Counts as a session for this area (a weekend outing counts as the walk). */
  countsFor?: string;
  createdAt: number;
}

export type BillSchedule =
  | { type: "monthly"; day: number }
  | { type: "weekly"; dow: number }
  /** Every N days after the last time it was done (clean room every 3 days). */
  | { type: "every"; days: number };

/** A bill or a recurring chore. Reminders come "N days before" and can be turned off (autopay). */
export interface Bill {
  id: string;
  name: string;
  kind: "bill" | "chore";
  schedule: BillSchedule;
  /** Remind this many days before it's due: [3] = three days before, [2, 0] = two days before and on the day. */
  remindDaysBefore: number[];
  /** Time of day for reminders ("HH:mm"). */
  time: string;
  /** On autopay: tracked, but never reminds. */
  autopay: boolean;
  enabled: boolean;
  /** What the reminder says. `{name}` is your name. */
  note: string;
  /** Reminder lists what's on your shopping list. */
  groceries?: boolean;
  lastDone?: ISODate;
  /** First due date for "every N days". */
  startDate?: ISODate;
}

export interface GroceryItem {
  id: string;
  name: string;
  done: boolean;
  addedAt: number;
}

export interface Goal {
  id: string;
  text: string;
  done: boolean;
}

/** This month's must-haves, pinned to the top of Today. */
export interface MonthGoals {
  /** "YYYY-MM" */
  month: string;
  items: Goal[];
}

/** Things to pull from when you have free time. */
export interface BoredIdea {
  id: string;
  text: string;
  areaId?: string;
}

export interface Profile {
  /** false until the first-run setup has been saved or skipped. */
  setupDone: boolean;
  /** Used in friendly notifications ("Have you sorted your email, Sahil?"). */
  name: string;
  /** Days you usually go into the office (shown on Today). */
  officeDays: number[];
  slots: Slot[];
  rhythm: RhythmItem[];
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
  /** Minutes before a fixed event to remind you. */
  eventLeadMin: number;
  /** When the daily "conscience" nudge (empty day, neglected area, behind target) is sent. */
  nudgeTime: string;
  /** Sunday weekly review reminder. */
  reviewTime: string;
  notify: {
    morning: boolean;
    taskCheckIns: boolean;
    wrap: boolean;
    reminders: boolean;
    slots: boolean;
    /** Fixed events and bills / chores. */
    events: boolean;
    bills: boolean;
    /** Empty-day, neglected-area and behind-target nudges. */
    nudges: boolean;
    review: boolean;
  };
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
  /** Set once the one-off defaults for sessions / rhythm have been applied (see lib/seed.ts). */
  seeded?: number;
}

export interface AppData {
  /** Bump when the shape changes and add a step in lib/backup.ts `migrate`. */
  version: 1;
  tasks: Task[];
  settings: Settings;
  /** "Me": routines, areas and shortcuts. Missing = defaults (see lib/profile.ts). */
  profile?: Profile;
  /** Finished sessions (the counters come from these). */
  sessions?: SessionLog[];
  /** Done / skipped / snoozed check-ins, pruned after ~60 days. */
  log?: DayEntry[];
  events?: FixedEvent[];
  bills?: Bill[];
  grocery?: GroceryItem[];
  goals?: MonthGoals;
  bored?: BoredIdea[];
}

export const MAX_FOCUS = 3;
