# Stability + Google safety copy pass (1 freeze · 2 sheet stack · 3 Plan mirror · 4 Gmail contract · 5 app notes · 6 release)

## Where things are

- **Sync pipeline** (`lib/syncPipeline.ts`, steps in `lib/syncSteps.ts`): the only place that schedules reminders, writes the Plan calendar, reads the Inbox, updates the widget, checks backups, compacts history. Debounced 800 ms, one run at a time, coalescing, loop breaker. Components only call `requestSync(reason)`; the store calls it on every non-quiet change.
- **Saving** (`lib/store.ts`): debounced 300 ms, flushed on pause / background / page hide (`flushNow`). `commit(..., { quiet: true })` is for bookkeeping that must not start a sync (`actions.bookkeeping`, `calendarChecked`, `recordCheck`, `compact`). `dataVersion()` counts changes.
- **Native calls** (`lib/nativeGuard.ts`, `lib/nativeBridge.ts`, `lib/notifications/native.ts`): every call has a 5 s limit (longer only where a permission dialog waits for a tap); a hang or rejection is logged and the fallback is used.
- **Error log** (`lib/debugLog.ts`): last 50 errors in local storage; Settings → Health → Recent errors; `ErrorBoundary.tsx` for render crashes.
- **History compaction** (`lib/compact.ts`, `lib/compactRun.ts`): raw history older than 8 weeks goes to `Documents/TodayBackups/today-history-YYYY-MM-DD.json` first, then leaves the data; the weekly snapshot keeps the numbers.
- **Sheet stack** (`lib/sheetStack.ts`, `Sheet` in `components/ui.tsx`): z-index from open order, one backdrop (top sheet), Escape/Back close the top one, `closeAllSheets()` for a notification tap, the scroll lock follows the stack. Sheets are portalled to `<body>`.
- **Plan mirror** (`lib/mirror.ts` pure diff, `lib/mirrorRun.ts`, `lib/calendarNames.ts`; Android `MirrorStore.java`, daily alarm in `BackupReceiver.java`).
- **Gmail contract** (`lib/inbox.ts` pure, `lib/inboxRun.ts`, `lib/remindClash.ts`, `components/InboxCards.tsx`); reminders for `#today-remind` events in `lib/notifications/plan.ts` (`remindable`).
- **App notes** (`lib/appNotes.ts`, `components/AppNotes.tsx`, `intentOf` in `lib/intentPhrases.ts`).
- **Release build**: `npm run android:release` (`scripts/android-build.mjs`, `scripts/jdk.mjs`, `scripts/verify-signature.mjs`).

## Judgement calls

- **Freeze causes**: found from the code and from profiling a synthetic data set (my-data.json was still not supplied). The scroll-lock leak, Escape/Back closing every sheet, the never-recovering reschedule chain, whole-file writes on every tap and the growing history are demonstrated by tests; the rest are measured. Nothing was run on a phone.
- **Mirror content**: sessions, tasks (incl. life admin), bills/chores and events typed in Today. Not mirrored: commute/lunch/tea, the daily rhythm pings (`chore` items such as "Sort emails"), phone-calendar events, and events Today already wrote to the phone calendar. Bills and flexible tasks are all-day `To-do:`; sessions keep their planned time.
- **Final state of a past day**: done → `✓`, skipped → `✗`, anything else stays plain (it was not skipped, only not done).
- **The 06:00 alarm** runs in Java from the last 14-day plan the app saved (Android cannot run the planner without the app). It rolls the 7-day window forward, repairs changed entries and finalises the day that ended. New planner decisions appear on the next open.
- **Event ids** are kept in Android (`today_mirror` preferences), not in the app data, so the alarm and the app share one map. If the map is lost (reinstall) the app first removes the future mirror events it finds by their note, then writes the plan again, so nothing doubles.
- **No reminders on mirror events**: the app sets none; Google may still add the calendar's own default notifications, so the guide says to set "Today – Plan" notifications to None.
- **History archive** is a separate `today-history-….json` file next to the weekly backups (the weekly file stays small); 52 are kept.
- **DIGEST**: stored in settings when read; the card needs it to be today's and after 19:00; the evening check-in text replaces "Anything from email to add?" with "3 emails need you".
- **#today-remind clash card** only for clashes with work hours (as asked), once answered it is not shown again for that event.
- **Release build**: signed with the debug keystore (installs over the current app), `debuggable false`, R8/minify and resource shrinking OFF (Capacitor and our own plugin are found by name at run time; the JS is already minified by Next).
- **Java**: Gradle 8.14 cannot run on Java 25 (Android Studio's bundled JDK is 25 now). `scripts/jdk.mjs` uses `~/.jdks/jbr-21*` (or `TODAY_JAVA_HOME`).
- **Duplicate keys**: two sessions of one area on one day, or two missed ones in "Still to do", used to share the key `session:job`; the second now gets `#2` (React warned about this, and rows could be duplicated or dropped).
- **Tests**: `jsdom` was added as a dev dependency for the sheet-stack component tests; `vitest.config.mts` has the `@` alias and picks up `.test.tsx`.

## Not verified on a device

The sheet stack and persistence were exercised in the browser preview and in tests. On Android nothing was run: the Plan calendar writes, the 06:00 alarm, Inbox import/deletion, `#today-remind` reminders, the history archive file and the release APK installing over the current app. The phone checklist in the report covers them.
