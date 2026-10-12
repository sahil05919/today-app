import { ensureWeeklyBackup } from "./backupFiles";
import { syncPhoneCalendar } from "./calendarSync";
import { runCompaction } from "./compactRun";
import { toISO } from "./dates";
import { pushWidgetSnapshot, takeWidgetActions } from "./nativeBridge";
import { importInbox } from "./inboxRun";
import { mirrorStep } from "./mirrorRun";
import { rescheduleAll } from "./notifications/native";
import { isNative } from "./platform";
import { requestSync, setSyncSteps, type SyncStep } from "./syncPipeline";
import { getData, onDataChanged, reloadFromStorage, whenLoaded } from "./store";
import { buildWidgetSnapshot, snapshotSignature } from "./widget";
import { applyWidgetActions } from "./widgetRun";

/** Dones tapped on the widget are applied through the normal actions, once the saved data is loaded. */
export async function absorbWidgetActions() {
  await whenLoaded();
  const list = await takeWidgetActions();
  if (list.length) applyWidgetActions(list);
}

let lastWidgetSig = "";
/** Computes the widget's snapshot and hands it to Android when it differs from what it has. */
export async function syncWidget(force = false) {
  const snap = buildWidgetSnapshot(getData(), new Date());
  const sig = snapshotSignature(snap);
  if (!force && sig === lastWidgetSig) return;
  lastWidgetSig = sig;
  if (!(await pushWidgetSnapshot(sig))) lastWidgetSig = "";
}

let lastDay = "";

/**
 * The steps of the sync pipeline, in order. Each is idempotent (it does nothing when nothing differs), so running them again
 * after a change never causes a chain.
 */
export function syncSteps(): SyncStep[] {
  return [
    {
      // Things that arrive from outside and change the data first: Dones tapped on the widget, and anything another process wrote.
      name: "inputs",
      reasons: ["open", "resume"],
      async run() {
        await absorbWidgetActions();
        await reloadFromStorage();
      },
    },
    {
      // The phone's calendar: events become fixed blocks; "Today – Inbox" tasks are imported; the Gmail digest is picked up.
      name: "calendar-read",
      reasons: ["open", "resume", "daily", "manual"],
      // Android's permission dialog is shown once, when the app opens (calendarAsked() remembers it was).
      run: ({ reasons }) => syncPhoneCalendar({ ask: reasons.has("open") }),
    },
    {
      // "Today – Inbox": TASK: events become tasks (once), today's DIGEST: is picked up.
      name: "inbox",
      reasons: ["open", "resume", "daily", "manual"],
      async run() {
        await importInbox();
      },
    },
    {
      name: "notifications",
      reasons: ["change", "open", "resume", "daily", "manual", "tick"],
      async run({ force, reasons }) {
        // The 5-minute tick only matters when the day has rolled over (the 14-day window moves by a day).
        const today = toISO(new Date());
        if (reasons.size === 1 && reasons.has("tick") && today === lastDay) return;
        lastDay = today;
        await rescheduleAll(getData(), { force });
      },
    },
    {
      // "Today – Plan": the safety copy of the next 7 days in Google Calendar (diff only; zero writes when nothing changed).
      name: "plan-mirror",
      reasons: ["change", "open", "resume", "daily", "manual"],
      async run() {
        await mirrorStep();
      },
    },
    {
      name: "widget",
      async run({ force }) {
        await syncWidget(force || undefined);
      },
    },
    {
      name: "backup-check",
      reasons: ["open", "resume", "daily"],
      async run() {
        await ensureWeeklyBackup();
      },
    },
    {
      name: "compact-history",
      reasons: ["open", "daily"],
      async run() {
        await runCompaction();
      },
    },
  ];
}

let installed = false;
/** Android shell: installs the steps and asks for the first run. */
export function startSync() {
  if (installed || !isNative()) return;
  installed = true;
  // Only once the saved data has been read: a sync on the empty placeholder would cancel every reminder.
  void whenLoaded().then(() => {
    setSyncSteps(syncSteps());
    onDataChanged(() => requestSync("change"));
    requestSync("open", { immediate: true });
  });
}
