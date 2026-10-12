# Assistant pass (1 fixes · 2 self-check · 3 daily flow · 4 day done · 5 life admin · 6 email → event · 7 calendar + backups)

Schema `version: 3`. Before the first v3 save the raw data is copied to `today:v1:backup-pre-v3` (and `…pre-v2` if it was still v1). Both are written once and never overwritten.

## Where things are

- **Fixes**: `lib/timeline.ts` (`buildTimeline(..., { today })`: a day that is not the real today never carries anything over), `lib/cleanup.ts` (de-dupe series, remove typed commands, runs inside `migrate`), `lib/schedule.ts` (`planWeek`: normal pass, then the hard-rule pass; `Shortfall`), `lib/targets.ts` (`weekTargets`, "N of M fit"), `components/ShortfallCard.tsx`, `components/RepeatingTasks.tsx`.
- **Self-check**: `lib/selfcheck.ts` (pure), `lib/selfcheckRun.ts` (native pending ids, backup file age), `components/CheckCard.tsx`, `components/HealthSettings.tsx`. Runs on the first open each day and on resume after 12 h (`App.tsx`).
- **Notifications**: `lib/notifications/plan.ts` (what exists), `budget.ts` (5 a day; exempt: reminder, event, bill, timer, eventprep), `lib/brief.ts` (brief, quote moment, evening check-in words), `native.ts` (`notifyDayDone`, kept across reschedules).
- **Today**: `components/ProgressHeader.tsx`, `Timeline.tsx` ("To-do today"), `lib/gentle.ts` (friendly nudge words), `EveningWrap.tsx` (Done / Tomorrow / Not sure), `DayDoneCard.tsx`.
- **Lighten my week**: `lib/lighten.ts`, `components/LightenSheet.tsx`, `lib/intentPhrases.ts` (typed commands, checked before task capture in `Capture.tsx`).
- **Life admin / side work**: `lib/lifeAdmin.ts`, `lib/sideWork.ts` + `lib/side-work-sources.json`, `components/SideWorkSheet.tsx`, `LifeAdminSettings.tsx`. Nth-weekday rules live in `lib/recur.ts` (`isNthWeekday`) and `lib/series.ts` (`ruleHits`).
- **Email → event**: `lib/shareParse.ts` (offline), `shareAi.ts` (Gemini, only when no date), `shareClash.ts`, `components/ShareEventSheet.tsx`. Routed in `App.tsx` (`onShared`).
- **Calendar write / backups**: `lib/calendarWrite.ts`, `lib/backupFiles.ts`, `components/BackupSettings.tsx`; Android: `TodayNativePlugin.java` (calendar write, backup methods), `BackupStore.java`, `BackupReceiver.java`.

## Judgement calls

- **my-data.json was not provided** (not in the project, Downloads, Desktop or Documents), so the causes were found from the code and reproduced with fixtures built from the description; every fix has a test that fails on the old code.
- **Targets are hard, but not at any cost**: the hard-rule pass may use other slots, weekends, a fuller evening (30 % over the cap) and two sessions in a day (areas of 5 a week or fewer). A daily habit (6+ a week) is never doubled up; it is reported ("English: 6 of 7 fit this week") instead. A day never goes past 4.5 h of sessions on a weekday, 2 h 40 on a weekend.
- **Round-robin**: when the week is overfull, each area gets one session per round (its own slots first, then any free time), so one area cannot take all the free time.
- **Friday catch-up suggestions** now mean "what the plan could NOT place". What fits is already in the plan.
- **Life admin** never goes to "Waiting for room": it takes the best gap on its day, even past the evening cap. Its ids are fixed (`life-<id>`). It is left out of the morning brief.
- **Quote**: daily, a random 5-minute step between 11:00 and 16:00 (repeatable for a date), on the pop-up channel, exact. It was a quiet, non-exact check-in before.
- **Morning brief** is only sent for a day the app has not been opened (`settings.openedDate`), and is silent if there is nothing to say.
- **The old 20:00 "Sort emails" ping is replaced by the evening check-in** (removed once from the defaults if you had not changed it).
- **Pulled sessions** become a task of that area that remembers the session (`origin`), exactly like Reschedule, so numbering and weekly count are kept. Only this week's sessions are raided.
- **Weekly backup uses an alarm** (`setAndAllowWhileIdle`, not exact), re-armed after reboot/update; if a Sunday is missed the app takes the backup at the next start.
- **Calendar write** is done in our own native plugin (no third-party calendar plugin): same permission model as the read side.
- **Tests**: a few old tests assumed a session could be dropped silently. They now assert the hard rule (see the commit for 1 and 3). `vitest.config.mts` has a 30 s test timeout.

## Not verified on a device

The Android parts compile and the debug APK builds (`android/app/build/outputs/apk/debug/app-debug.apk`), but nothing was run on a phone: calendar write, the Documents/TodayBackups file (and that it outlives an uninstall), the Sunday alarm, the share sheet. The checklist in the report covers them.
