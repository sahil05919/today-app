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
}

export interface AppData {
  /** Bump when the shape changes and add a step in lib/backup.ts `migrate`. */
  version: 1;
  tasks: Task[];
  settings: Settings;
  // Later: events?: SavedEvent[]  (see lib/events)
}

export const MAX_FOCUS = 3;
