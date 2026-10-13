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
  /** monthly + weekdays: the Nth such weekday of the month (1–4), or -1 for the last ("1st Saturday", "last Sunday"). */
  nth?: number;
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
  /** "backdated" = a missed day filled in afterwards. Left out of slot learning. */
  via?: "backdated";
}

/** What happened to a check-in on a given day (done / skipped / snoozed). */
export interface DayEntry {
  /** "session:<areaId>:<date>", "chore:<id>:<date>" or "wrap:<date>" */
  key: string;
  /** "early" = this planned occurrence was done ahead of time on another day, so it is gone: no slot, no reminder. */
  status: "done" | "skip" | "snooze" | "early" | "moved";
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
  /** An area id for an event made from an email ("sidework"). */
  area?: string;
  /** What the email said it was: "Approved", "Standby"… */
  status?: string;
  /** A shift or booking made from an email: it gets lead-up reminders (2 days before 19:00, the evening before 21:00). */
  shift?: boolean;
  /** A calendar event whose notes carry #today-remind: it gets the lead-up reminders and the work-clash check, like a shared shift. */
  remind?: boolean;
  /** The id of the same event in the phone's calendar (written by Today), so an edit or a delete updates it and a re-read never duplicates it. */
  calEventId?: string;
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
  /** A "done" phrase remembered for an item: "session:guitar", "bill:groceries", "rhythm:emails" or "task:finance review". */
  item?: string;
}

/** An area hit its weekly target: the celebration, and the time that was freed (offered once). */
export interface FreedOffer {
  areaId: string;
  /** Monday of the week it was reached. */
  week: ISODate;
  at: number;
  /** The earliest planned session that is no longer needed. */
  slot?: { date: ISODate; start: number; end: number };
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
  /** Sunday "Your week" review reminder (default 21:00). */
  reviewTime: string;
  /** Friday "Week so far" reminder (default 21:00). */
  fridayReviewTime: string;
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
  /** Read events from the phone's calendar (Android). */
  calendarSync: boolean;
  /** Also write the events you create in Today (typed "event …", or from an email) to the phone's calendar. */
  calendarWrite: boolean;
  /** Which calendar they go to (the phone's own id). Empty = your Google account's calendar. */
  writeCalendarId?: string;
  /** Keep a safety copy of the next 7 days in the Google calendar named "Today – Plan" (see lib/mirror.ts). */
  planMirror: boolean;
  /** Which phone calendar is the Plan / Inbox one (the phone's own id). Empty = found by its name. */
  planCalendarId?: string;
  inboxCalendarId?: string;
  /** Items the planner puts in a day: 0 = Auto (learned from what you really finish, see lib/dayCapacity.ts), or a number. */
  capacityItems: number;
  /** The weekly target for "Other work", in hours (0 = no target). */
  otherHours: number;
  /** The planner never auto-places anything before this time (things you timed yourself are not moved). */
  earliestAuto: string;
  /** Weekend time of the morning "How are you feeling?" (weekdays use `morningCheckIn`). */
  morningWeekend: string;
  /** A quote notification every N days (1 = every day); 0 = off. */
  quoteEvery: 0 | 1 | 2 | 3;
  /** Old fixed time; the quote now arrives at a random moment between `quoteFrom` and `quoteTo`. */
  quoteTime: string;
  quoteFrom: string;
  quoteTo: string;
  /** The morning brief: sent only if the app has not been opened yet that day. */
  briefTime: string;
  /** The evening check-in: "Tonight: X, Y. Anything from email to add?" */
  checkinTime: string;
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
    /** Sunday "Your week". */
    review: boolean;
    /** Friday "Week so far". */
    weekSoFar: boolean;
    /** A quote at a random time in the afternoon. */
    quote: boolean;
    /** The evening check-in (20:00). */
    tonight: boolean;
    /** A nudge at the planned time, only for areas behind their weekly target. */
    sessionNudges: boolean;
    /** "All done for today" once the day's list is finished. */
    dayDone: boolean;
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
  /** Completing this task counts as a session of that area ("Power BI extra session" in a freed slot). */
  countsFor?: string;
  /** The session log made when it was completed (removed again if you reopen it). */
  sessionLogId?: string;
  /** Made by the app (a rescheduled session, a freed-slot extra), not typed by you. */
  generated?: boolean;
  /** Where a rescheduled session / chore / bill came from, so finishing this task finishes the original. */
  origin?: TaskOrigin;
  /** Occurrence view of a repeating series (never stored in `tasks`): the series and the day it belongs to. */
  seriesId?: string;
  occDate?: ISODate;
}

/** A session, chore or bill that was rescheduled into a one-off task. */
export interface TaskOrigin {
  kind: "session" | "chore" | "bill";
  /** The `data.log` key of the original ("session:powerbi:2026-10-07"); marked "moved" while this task is open. */
  key: string;
  date: ISODate;
  areaId?: string;
  choreId?: string;
  billId?: string;
  /** Bill: the due date it was for. */
  due?: ISODate;
  /** Made by the end-of-day sweep (it was missed), not by you choosing Reschedule. */
  carried?: boolean;
  /** Bill: when it was last paid / done before this task finished it (so reopening restores it). */
  prevLastDone?: ISODate;
}

/**
 * A repeating task. Occurrences are COMPUTED from the rule (lib/series.ts `getOccurrences`), nothing is generated
 * ahead of time and finishing one never creates the next. Every occurrence inherits `time`.
 */
export interface Series {
  id: string;
  title: string;
  notes?: string;
  /** "HH:mm": every occurrence has this time. Omitted = no fixed time. */
  time?: string;
  estimateMin?: number;
  area?: string;
  tags: string[];
  important: boolean;
  /** The steps every occurrence starts with (not done). */
  steps: Step[];
  template?: TemplateId;
  countsFor?: string;
  rule: Recurrence;
  /** A life-admin series (lib/lifeAdmin.ts): its id there, e.g. "laundry". Such a series rolls forward once, then drops. */
  lifeId?: string;
  /** Switched off (Settings → Life admin): it makes no occurrences until it is switched on again. */
  off?: boolean;
  /** First day it can happen. */
  startDate: ISODate;
  /** Counting for "every N days / weeks / months" starts here. Defaults to `startDate`. */
  anchor?: ISODate;
  /** Last day it can happen (inclusive): set when you turn repeat off or change "this and future". */
  until?: ISODate;
  createdAt: number;
}

/**
 * The small record kept only when one occurrence differs from its series: done, skipped, missed, moved to another
 * time, or edited "this one only". Key = seriesId + the ORIGINAL day.
 */
export interface Occurrence {
  key: string;
  seriesId: string;
  date: ISODate;
  status?: "done" | "skipped" | "missed";
  doneAt?: number;
  /** Rescheduled: where it went. */
  movedTo?: { date: ISODate; time?: string };
  /** Time override for this occurrence (HH:mm). */
  time?: string;
  /** This occurrence exists although the rule wouldn't produce it (a migrated or hand-moved copy). */
  extra?: boolean;
  /** Edited "this one only". */
  over?: Partial<Pick<Task, "title" | "notes" | "estimateMin" | "area" | "tags" | "important" | "steps">>;
  /** Ids of the series steps ticked on this occurrence. */
  stepsDone?: string[];
  sessions?: { at: number; min: number }[];
  sessionLogId?: string;
  remindAt?: number;
  alarmAck?: number;
  snoozeCount?: number;
  /** "Adjust my day" parked it until this day. */
  hideUntil?: ISODate;
  focus?: boolean;
  lastCheckIn?: { date: ISODate; status: CheckInStatus };
}

/** One thing that happened, forever (append-only). The weekly review is computed from these. */
export interface HistoryEvent {
  id: string;
  /** When it happened (epoch ms). */
  at: number;
  /** The day the item belonged to. */
  date: ISODate;
  kind: "done" | "skipped" | "missed" | "rescheduled" | "reopened" | "pulled" | "cleared";
  type: "session" | "task" | "event" | "bill" | "routine";
  /** The item's identity ("session:powerbi:2026-10-07", "occ:<series>@<date>", "task:<id>", "event:<id>:<date>"). */
  key: string;
  title: string;
  area?: string;
  /** You captured it (task, event) rather than the app generating it (session, routine, bill reminder). */
  createdByMe: boolean;
  /** Rescheduled: the new day and time. */
  to?: { date: ISODate; time?: string };
}

/** A tweak to one routine block on one day ("Commute is 120 min today"). */
export interface BlockOverride {
  start?: number;
  min?: number;
  skip?: boolean;
}

/** Your local marks on an event from the phone's calendar (never written to the calendar itself). */
export interface EventMark {
  done?: number;
  hidden?: boolean;
  start?: string;
  end?: string;
}

/** The numbers behind one finished week (saved so past weeks can be listed and compared). */
export interface WeekSnapshot {
  week: ISODate;
  at: number;
  kind: "week-so-far" | "your-week";
  areas: Array<{ id: string; name: string; emoji: string; done: number; target: number }>;
  own: { added: number; finished: number; names: string[] };
  events: { handled: number; names: string[] };
  focus: string[];
  text: string;
  /** "Other work" that week, in minutes, and its target then. */
  other?: { minutes: number; target: number };
}

/** Side work (the Monday check): what you star, hide and add, and what is ticked each week (Monday ISO date → source ids). */
export interface SideWorkState {
  /** The "Every week" sources (source ids). */
  weekly: string[];
  hidden: string[];
  custom: Array<{ id: string; name: string }>;
  checks: Record<ISODate, string[]>;
}

/** One thing the morning self-check found that needs a look (see lib/selfcheck.ts). */
export interface CheckIssue {
  id: string;
  kind: "target" | "notification" | "orphan" | "backup" | "mirror";
  text: string;
  /** What the button does: open the targets chooser, offer the old items for Lighten my week, or back up now. */
  action?: "targets" | "lighten" | "backup";
}

/** The last result of the self-check: what was fixed quietly, and what needs a look. */
export interface CheckResult {
  at: number;
  date: ISODate;
  issues: CheckIssue[];
  fixed: string[];
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
  /** The one-time "allow exact reminders" prompt has been shown. */
  exactAsked?: boolean;
  /** Monday (ISO) of the week whose Friday "Week so far" was opened or dismissed. */
  sofarWeek?: ISODate;
  /** "Apply focus": these areas get earlier, first-pick slots in that week's plan. */
  focus?: { week: ISODate; areas: string[] };
  /** Weekly targets already celebrated ("<Monday>:<areaId>"), so it happens once. */
  celebrated?: string[];
  /** The latest "target reached" card on Today, until it is answered. */
  freed?: FreedOffer;
  /** Areas whose "2 of 4 fit this week" card was set aside for this week. */
  shortDismissed?: { week: ISODate; areas: string[] };
  /** The day the app was first opened (the morning brief is not sent once it has been). */
  openedDate?: ISODate;
  /** The day the "All done for today" card + notification was shown / the day "Take it easy" was answered. */
  dayDoneDate?: ISODate;
  calmDate?: ISODate;
  /** The morning self-check: its last result, and the day its card was set aside. */
  lastCheck?: CheckResult;
  checkDismissed?: ISODate;
  /** History compaction (lib/compact.ts): the day it last ran, and when an archive write last failed (retry later). */
  compactedDate?: ISODate;
  compactFailedAt?: number;
  /** The "Today – Plan" mirror: when it last ran and how it went (shown in Settings and the Health check). */
  /** Gmail add-on (lib/inbox.ts): TASK: events already imported (never twice), today's DIGEST, whether its card was dismissed, tasks added since the toast. */
  inboxSeen?: string[];
  digest?: { date: ISODate; title: string; items: string[] };
  digestDismissed?: ISODate;
  inboxAdded?: { n: number; at: number };
  /** Event ids whose "clashes with work" card was answered. */
  clashDismissed?: string[];
  mirror?: { at: number; status: "ok" | "off" | "no-calendar" | "not-google" | "pick-calendar" | "no-permission" | "error" | "unsupported"; calendar?: string; written?: number };
}

export interface AppData {
  /** Bump when the shape changes and add a step in lib/backup.ts `migrate`. 2 = repeats are series + occurrences, 3 = the assistant pass, 4 = the final feature pass (cleared windows, Other work, notes, learning log…: all optional, so the step is only a backup and a stamp). */
  version: 1 | 2 | 3 | 4;
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
  /** Repeating tasks (see Series). */
  series?: Series[];
  /** Records for occurrences that differ from their series. */
  occurrences?: Occurrence[];
  /** Everything that was done / skipped / missed / rescheduled, append-only. */
  history?: HistoryEvent[];
  /** Time logged by typing, and your corrections of Other sub-labels (keyed like OtherEntry.key). */
  worklog?: WorkLog[];
  workSubs?: Record<string, SubLabel>;
  /** Cleared stretches of days (see ClearedWindow). */
  cleared?: ClearedWindow[];
  /** Notes about the app, from "app: …" in Capture. */
  notes?: AppNote[];
  /** Side work: the Monday check (see lib/sideWork.ts). */
  sideWork?: SideWorkState;
  /** "Just today" tweaks to routine blocks, keyed "<blockId>@<date>". */
  blocks?: Record<string, BlockOverride>;
  /** Marks on phone-calendar events, keyed "<calId or id>@<date>". */
  eventMarks?: Record<string, EventMark>;
  /** One snapshot per Friday / Sunday review (last 26 kept). */
  weeks?: WeekSnapshot[];
  /** Runtime only, never saved: the window in which repeat occurrences were added to `tasks` (see withOccurrences). */
  expanded?: { from: ISODate; to: ISODate };
}

/** A note about the app itself, typed in Capture as "app: …" (Settings → App notes). */
export interface AppNote {
  id: string;
  at: number;
  date: ISODate;
  text: string;
}

/** A stretch of a day you cleared ("clear until 7pm"): a busy block the planner will not refill (lib/clear.ts). */
export interface ClearedWindow {
  id: string;
  /** All the windows of one command share a group (a clear across midnight is two windows). */
  group: string;
  date: ISODate;
  /** Minutes after midnight. */
  start: number;
  end: number;
  at: number;
}

/** Where a piece of "Other work" belongs (guessed from its words, editable). */
export type SubLabel = "Building" | "Chores" | "Admin" | "Learning" | "Other";

/** Time you spent and told the app about ("spent 2 hrs building the app"). Counted under Other. */
export interface WorkLog {
  id: string;
  date: ISODate;
  minutes: number;
  title: string;
  sub: SubLabel;
  at: number;
}

export const MAX_FOCUS = 3;
