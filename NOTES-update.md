# Update map (A repeats · B reschedule · C editable · D weekly review)

Recon of the existing app (`lib/` = pure logic, `components/` = UI, `tests/` = vitest):

- **Data + storage**: `lib/types.ts` (AppData v1), `lib/store.ts` (`actions`, `commit`, Capacitor Preferences key `today:v1`, web `localStorage`), `lib/backup.ts` `migrate()` = the load-time *cleaner* (unknown fields are stripped, so every new field must be added there).
- **Planner**: `lib/schedule.ts` (`planSessions`, `plannedForDay`: weekly sessions into slots), `lib/busy.ts` (`dayRules`, `planningBusy`: commute/lunch/tea/work + events + timed tasks), `lib/timeline.ts` (`buildTimeline`: ONE day = fixed items + flexible placed in gaps, `late`/`carried` flags, overflow), `lib/settle.ts` + `lib/pileup.ts` (reshuffle overflow / catch-up to next free day, `firstDayWithRoom`).
- **Done rules**: `lib/done.ts` (`applyDone`, `completeTaskIn` - the old "finish spawns the next copy" repeat model lives here), `lib/sessions.ts` (session logs, `data.log` keys `session:/chore:/bill:`).
- **Notifications**: `lib/notifications/plan.ts` (pure `planNotifications`, 7-day window, `hashId(key)` stable ids), `native.ts` (Capacitor LocalNotifications: cancel-all + schedule, taps -> `TapTarget`, action buttons), `lib/tap.ts` (`resolveTap`), `components/NativeShell.tsx` (reschedule after each change / resume).
- **UI**: `components/App.tsx` (state, toast, sheets), `TodayView` + `Timeline` (Next up, rows), `TodayPlan` (`ItemSheet` Done/Start/Snooze/Skip, `EventSheet`), `TaskSheet` (Date/Time/Repeat/Steps), `SnoozeSheet`/`WhenSheet`, `CalendarSheet` (week/month, built from `buildTimeline` per day), `NextDays` + `lib/upcoming.ts` ("Coming up"), `WeeklyReview` + `lib/coach.ts` (Sunday letter), `ProfileSheet` (Settings), `NotificationSettings`.
- **Plan**: every reader that wants tasks goes through `lib/series.ts` `getOccurrences()` (series + small occurrence records; virtual tasks have id `seriesId@YYYY-MM-DD`); `withOccurrences(data, from, to)` feeds the existing timeline/notification code unchanged. Writes to an occurrence id are routed in `store.ts` to occurrence records.
- **Data safety**: schema `version: 2`; before the first v2 save the raw v1 JSON is copied to `today:v1:backup-pre-v2` (never overwritten); migration is idempotent.
- **Test timezone**: `vitest.config.ts` pins `TZ=Europe/London` (DST test around Sun 25 Oct 2026).

## Judgement calls (where the brief was silent)

- **Repeat rules** keep counting from the series anchor, not from when you finished one (the old "finish creates the next" drift is gone). "Every 3 days" is 12th, 15th, 18th… whatever you tick. Bills/chores ("clean room every 3 days") still restart from the day they were done, as before.
- **Missed carry rule** applies to every series, not only daily ones: only the latest unresolved occurrence carries; older ones are logged `missed`.
- **Rescheduled / carried sessions, chores and bills become one-off tasks** that remember their origin (`Task.origin`). Finishing the task finishes the original; a session keeps its weekly count (the planner subtracts open `countsFor` tasks of the week from what it still has to plan).
- **What is carried into "Still to do"**: overdue tasks, a repeat's latest missed day, yesterday's missed sessions (this week only), bills/chores due in the last 3 days. Rhythm check-ins ("Sort emails") and events are not carried (they are daily pings / fixed-time).
- **Skip on an ordinary task** removes it and logs it as `skipped` in the history (a task has no "skipped" state); Undo brings it back.
- **Reschedule +1 hour** is exactly now+60 (rounded to 5 min); past ~22:30 it rolls to tomorrow morning. "This evening" and "Tomorrow morning" use the first free slot (events, timed tasks, tea break, commute are avoided).
- **"Not sure"** leaves the task without a fixed time (the timeline keeps placing it) and shows the planner's chosen time in the toast.
- **Routine blocks**: "Running late" adds to the block's length; the evening/night session slots move later by the same amount as the tea break ends later; sessions that no longer fit before 22:30 move through the existing planner. "Every day" updates the rhythm setting (commutes: length only; their start follows work hours).
- **Calendar events**: Done/Hide/time override are stored as `eventMarks` keyed by phone-event id + day; nothing is ever written to the device calendar. A hidden event no longer blocks time that day.
- **Weekly review**: area numbers come from session logs (+ events that count as a session); own tasks/events/missed come from the history log. Repeats are listed separately ("↻ Vitamin 6 of 7"), not counted as "your own tasks". The default Sunday review time moves from 18:30 to 21:00 only if it was still the old default.
- **History** is appended by diffing the data on every change (`lib/history.ts`), so no code path can forget to log. The current week is backfilled once when data is upgraded.
- **Exact alarms**: the existing Settings switch is kept; a one-time sheet also appears on first launch if Android has them off.
