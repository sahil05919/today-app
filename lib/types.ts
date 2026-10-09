/** Local calendar date, "YYYY-MM-DD". Never a UTC timestamp, so it can't drift across timezones. */
export type ISODate = string;

/** How much energy a day has. Used by "How are you feeling?" and "Adjust my day". */
export type Energy = "low" | "ok" | "high";

/** The answer to the morning "How are you feeling?" check-in. */
export interface CheckInAnswer {
  date: ISODate;
  energy: Energy;
  /** Flexible things kept for the day, out of `offered`. */
  ticked: number;
  offered: number;
  at: number;
}

/**
 * Where the quote bag stands. The shuffled order is rebuilt from `seed` (so it never needs storing), `cursor` is how many
 * have been used, and `assigned` pins a date to its place so re-planning never changes it.
 */
export interface QuoteState {
  seed: number;
  cursor: number;
  assigned: Record<ISODate, number>;
  /** Quote ids saved with a heart. */
  saved: string[];
  /** The day counting started; "every N days" is counted from it. */
  anchor?: ISODate;
}

/** The Sunday coach letter for one week (Monday ISO date). */
export interface CoachLetter {
  week: ISODate;
  text: string;
  source: "ai" | "rules";
  at: number;
}

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
  /** The number the NEXT session gets, so counting continues from an older history ("Power BI starts at 14"). */
  startAt?: number;
  /** Sessions alternate through these names ("Job Prep", "Job Apply"). */
  variants?: string[];
  /** Notify when a planned session starts. */
  remind: boolean;
  /** Placement order inside a slot: lower goes first (Power BI before the walk). */
  order?: number;
  /** Keep the slot order exactly as set: don't let the planner learn a better slot from when sessions really happen. */
  lockSlots?: boolean;
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
  /** Where it came from. "calendar" = read from the phone's calendar (read-only mirror), "ics" = an opened invite. */
  source?: "calendar" | "ics";
  /** Calendar events only: the phone's own id, so a re-sync replaces rather than duplicates. */
  calId?: string;
}

/** A word you taught the dictionary: "pehchaan karna" → Admin. Used offline, before the built-in words. */
export interface UserWord {
  word: string;
  areaId: string;
  at: number;
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

/**
 * Something the app learned from a correction: "when a task looks like these words, file it under this area
 * (and/or at this time)". Kept on the device, applied offline and online.
 */
export interface LearnedRule {
  id: string;
  /** The meaningful words of the corrected title, e.g. ["starred", "email"]. A new title matching all of them gets the fix. */
  words: string[];
  areaId?: string;
  /** "HH:mm" */
  time?: string;
  hits: number;
  at: number;
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
  /** A protected tea / food break on weekdays; nothing is planned inside it. */
  breakStart: string;
  breakEnd: string;
  /** Breathing room between planned items, in minutes. */
  bufferMin: number;
  /** Most minutes of plans in an evening (after the break). Office days get a lighter share of it. */
  eveningCapMin: number;
  /** Commute each way on an office day, in minutes (the normal commute fields are for ordinary work days). */
  officeCommuteMin: number;
  /** Night mode: from sleepStart until wakeTime Today only says "time to sleep" and shows tomorrow's first item. */
  sleepStart: string;
  wakeTime: string;
  /** Hide the in-app microphone (the keyboard's own mic still works). */
  hideMic: boolean;
  /** Read events from the phone's calendar (Android, read-only). */
  calendarSync: boolean;
  /** Weekend time of the morning "How are you feeling?" (weekdays use `morningCheckIn`). */
  morningWeekend: string;
  /** A quote notification every N days; 0 = off. */
  quoteEvery: 0 | 1 | 2 | 3;
  quoteTime: string;
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
  /** "Adjust my day" parked it: don't plan it before this day (an overdue task keeps its due date, so it's still first in line then). */
  hideUntil?: ISODate;
  /** "Snooze 2h" from a notification: nudge me again at this time (epoch ms). */
  remindAt?: number;
  /** You've seen the alarm that rang at or before this time (epoch ms): stop the "Still waiting" follow-ups. */
  alarmAck?: number;
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
  timer?: {
    taskId?: string;
    /** A session / chore / bill timer: its timeline key. */
    ref?: string;
    label?: string;
    startedAt: number;
    /** "Do it now (15 min start)": say so once this many minutes have passed. */
    goalMin?: number;
  };
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
  /** Day the "this week is piling up" catch-up card was accepted or dismissed. */
  catchUpDate?: ISODate;
  /** When the phone calendar was last read (epoch ms). */
  calendarSyncedAt?: number;
  /** Times each non-task item (session, chore, bill) was snoozed, by timeline key; third time you must choose. */
  snoozes?: Record<string, number>;
  /** Day the morning "How are you feeling?" card on Today was dismissed. */
  feelingSkipDate?: ISODate;
  /** Day the "today is more than you usually finish" card was dismissed. */
  overloadSkipDate?: ISODate;
  /** Learned slot shifts already mentioned: areaId → slotId. */
  slotShifts?: Record<string, string>;
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
  /** Corrections remembered for next time (see lib/learn.ts). */
  learned?: LearnedRule[];
  /** Days marked as off days (at most 2 per Mon–Sun week). */
  offDays?: ISODate[];
  /** Read-only mirror of the phone's calendar events (replaced on every sync, never edited here). */
  calendarEvents?: FixedEvent[];
  /** Words you taught the offline dictionary. */
  userWords?: UserWord[];
  /** Morning "How are you feeling?" answers (last ~120 days). */
  checkins?: CheckInAnswer[];
  /** Quote bag, saved quotes. */
  quotes?: QuoteState;
  /** Sunday coach letters, newest last (last 12 kept). */
  letters?: CoachLetter[];
}

export const MAX_FOCUS = 3;
