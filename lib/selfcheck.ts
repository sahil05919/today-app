import { addDays, toISO } from "./dates";
import { PLAN_HELP } from "./calendarNames";
import { withDefaults } from "./profile";
import { dedupeSeriesReport, removeStrayTasks, strayTasks } from "./cleanup";
import { planNotifications } from "./notifications/plan";
import { withRepeats } from "./series";
import { shortLine, weekTargets } from "./targets";
import { weekStart } from "./stats";
import { buildTimeline } from "./timeline";
import type { AppData, CheckIssue, CheckResult, ISODate, Occurrence } from "./types";

/**
 * The morning self-check, so the person is never the one finding bugs. A pure function: it returns the data with everything
 * that is safe to fix already fixed, what it fixed (`fixed`), and what needs a look (`issues`).
 *
 *  - every area's weekly target is planned (or flagged: "Power BI: 2 of 4 fit this week")
 *  - no duplicate series or occurrences, no command saved as a task
 *  - every timed item in the next 7 days has its notification, and none exists for something done, skipped or deleted
 *  - no item has been "waiting for room" for more than 7 days (offered to Lighten my week)
 *  - there is a recent backup (not older than 8 days)
 */
export const ORPHAN_DAYS = 7;
export const BACKUP_MAX_DAYS = 8;
/** The check runs on the first open each day, and on resume if the last one is older than this. */
export const RECHECK_AFTER_MS = 12 * 3_600_000;
const DAY = 86_400_000;

export interface CheckOptions {
  /** The ids Android has scheduled right now (native only). Omitted on the web: the notification check is skipped. */
  pendingIds?: number[];
  /** Notifications are switched off in Android: nothing can be scheduled. */
  notificationsOff?: boolean;
  /** When the newest backup file was written (epoch ms), if known; otherwise the last backup recorded in the data. */
  lastBackupAt?: number | null;
}

export interface CheckOutput {
  data: AppData;
  result: CheckResult;
  /** The scheduled notifications on the phone differ from the plan: cancel and schedule them again. */
  reschedule: boolean;
}

/** Is a check due? First open of a day, or the last one is more than 12 hours old. */
export function checkDue(data: AppData, now: Date): boolean {
  const last = data.settings.lastCheck;
  return !last || last.date !== toISO(now) || now.getTime() - last.at > RECHECK_AFTER_MS;
}

const rank = (r: Occurrence) => (r.status === "done" ? 4 : r.status === "skipped" ? 3 : r.movedTo ? 2 : r.status === "missed" ? 1 : 0);

function dedupeOccurrences(d: AppData): { data: AppData; n: number } {
  const list = d.occurrences ?? [];
  const by = new Map<string, Occurrence>();
  for (const r of list) {
    const have = by.get(r.key);
    if (!have || rank(r) > rank(have)) by.set(r.key, r);
  }
  return by.size === list.length ? { data: d, n: 0 } : { data: { ...d, occurrences: [...by.values()] }, n: list.length - by.size };
}

export function runSelfCheck(input: AppData, now: Date = new Date(), opts: CheckOptions = {}): CheckOutput {
  const today = toISO(now);
  const fixed: string[] = [];
  const issues: CheckIssue[] = [];
  let data = input;

  // ---- Quiet fixes -------------------------------------------------------------------------------------------------------
  const dd = dedupeSeriesReport(data);
  if (dd.merged.length) {
    data = dd.data;
    fixed.push(dd.merged.length === 1 ? `Merged a duplicate “${dd.merged[0]}”` : `Merged ${dd.merged.length} duplicate repeating tasks`);
  }
  const dupOcc = dedupeOccurrences(data);
  if (dupOcc.n) {
    data = dupOcc.data;
    fixed.push(`Removed ${dupOcc.n} duplicate ${dupOcc.n === 1 ? "day" : "days"} of a repeating task`);
  }
  const strays = strayTasks(data);
  if (strays.length) {
    data = removeStrayTasks(data);
    fixed.push(`Removed ${strays.length === 1 ? "a command that was saved as a task" : `${strays.length} commands that were saved as tasks`}`);
  }

  // ---- Weekly targets ----------------------------------------------------------------------------------------------------
  const week = weekStart(today);
  const dismissed = data.settings.shortDismissed?.week === week ? data.settings.shortDismissed.areas : [];
  for (const s of weekTargets(data, now).short) {
    if (dismissed.includes(s.areaId)) continue;
    issues.push({ id: `target:${s.areaId}`, kind: "target", text: shortLine(s), action: "targets" });
  }

  // ---- Notifications -----------------------------------------------------------------------------------------------------
  let reschedule = false;
  if (opts.notificationsOff) {
    issues.push({ id: "notifications-off", kind: "notification", text: "Notifications are switched off, so no reminder will arrive." });
  } else if (opts.pendingIds) {
    const plan = planNotifications(data, now);
    const planIds = new Set(plan.map((n) => n.id));
    const weekAhead = now.getTime() + 7 * DAY;
    const pending = new Set(opts.pendingIds);
    const missing = plan.filter((n) => n.at.getTime() < weekAhead && !pending.has(n.id)).length;
    // Anything scheduled that the plan does not know: it belongs to something done, skipped or deleted.
    const stray = opts.pendingIds.filter((id) => !planIds.has(id)).length;
    if (missing || stray) {
      reschedule = true;
      fixed.push(
        [missing ? `Scheduled ${missing} missing reminder${missing === 1 ? "" : "s"}` : "", stray ? `cancelled ${stray} that no longer apply` : ""].filter(Boolean).join(", ").replace(/^c/, "C"),
      );
    }
  }

  // ---- Items that have been waiting for room for more than a week ---------------------------------------------------------------
  const eff = withRepeats(data, today);
  const old = new Map<string, string>();
  for (let i = 0; i <= 7; i++) {
    const day = addDays(today, i);
    for (const o of buildTimeline(eff, day, i === 0 ? now : new Date(`${day}T00:00:00`), { today }).overflow) {
      if (!o.carried && !o.task.seriesId && now.getTime() - o.task.createdAt > ORPHAN_DAYS * DAY) old.set(o.task.id, o.task.title);
    }
  }
  if (old.size) {
    issues.push({
      id: "orphans",
      kind: "orphan",
      text: old.size === 1 ? `“${[...old.values()][0]}” has been waiting for room for over a week.` : `${old.size} items have been waiting for room for over a week.`,
      action: "lighten",
    });
  }

  // ---- A recent backup ---------------------------------------------------------------------------------------------------------
  const last = opts.lastBackupAt ?? data.settings.lastBackupAt ?? data.settings.firstRunAt;
  const hasData = data.tasks.length > 0 || (data.series?.length ?? 0) > 0 || (data.sessions?.length ?? 0) > 0;
  if (hasData && now.getTime() - last > BACKUP_MAX_DAYS * DAY) {
    const days = Math.floor((now.getTime() - last) / DAY);
    issues.push({ id: "backup", kind: "backup", text: `No backup for ${days} days.`, action: "backup" });
  }

  // ---- The Google Calendar safety copy ("Today – Plan") --------------------------------------------------------------------
  const mirror = data.settings.mirror;
  if (mirror && withDefaults(data.profile).planMirror) {
    if (mirror.status === "no-calendar" || mirror.status === "not-google") issues.push({ id: "mirror", kind: "mirror", text: PLAN_HELP });
    else if (mirror.status === "no-permission") issues.push({ id: "mirror", kind: "mirror", text: "Allow Today to add to your calendar (Settings → Calendar) to turn on your safety copy." });
    else if (mirror.status === "error") issues.push({ id: "mirror", kind: "mirror", text: "The safety copy in Google Calendar could not be updated. See Settings → Health → Recent errors." });
  }

  const result: CheckResult = { at: now.getTime(), date: today, issues, fixed };
  return { data, result, reschedule };
}

/** What the home card says: "2 things need a look". Targets have their own card, so they are not counted twice. */
export function cardIssues(result: CheckResult | undefined, today: ISODate): CheckIssue[] {
  return result && result.date === today ? result.issues.filter((i) => i.kind !== "target") : [];
}

export const checkSummary = (result: CheckResult | undefined) =>
  !result ? "Not run yet" : result.issues.length ? `${result.issues.length} ${result.issues.length === 1 ? "thing needs" : "things need"} a look` : result.fixed.length ? "All good. Fixed a few things quietly." : "All good";
