# Final feature pass (1 earliest time · 2 clear · 8 other work · 3 capacity · 4 alarms · 5 learning log · 6 win jar · 7 share my week)

Data version 4 (`today:v1:backup-pre-v4` is written once before the first v4 save; all new fields are optional, so the step is a backup and a stamp and is idempotent).

## Where things are

- **Earliest auto-planning time** (`profile.earliestAuto`, 11:00): `schedule.ts` (`earliest()`), `timeline.ts` (`earliest`), `planday.ts`, `reschedule.ts` (`morningWindow`), and `notifications/plan.ts` (`QUIET_MORNING`: default pings before it are dropped; `exactTime` ones, events, alarms and the 09:30 brief stay).
- **Clear**: `clearParse.ts` (words → windows, chips), `clear.ts` (preview = the planner run on a copy; `applyClear`), `store.clearWindows` / `removeCleared`, `components/ClearSheet.tsx`; the "Cleared" block is `data.cleared`, read by `busy.ts` (`planningBusy`) and drawn by `timeline.ts` (muted `break`, `clearedId`). History kind `cleared`.
- **Other work**: `other.ts` (entries, week, sub-labels), `workLog.ts` (typed phrases), `progress.ts` (`weeklyPercent` in minutes), `weekly.ts` (`WeekStats.other`), `components/OtherWork.tsx`. Storage: `data.worklog`, `data.workSubs`, `profile.otherHours`.
- **Capacity**: `dayCapacity.ts` (`capFor`), used by `schedule.ts` (`tryPlace`, `relaxedSpot`) and `timeline.ts` (task queue). `settle.ts` judges a target day without today's other tasks.
- **Alarms**: `earlyAlarm.ts` (pure), `earlyAlarmRun.ts`, `components/AlarmButton.tsx`, native `setAlarm` in `TodayNativePlugin.java`, the `PREP` action type in `notifications/native.ts`, `setAlarm` on `PlannedNotification`.
- **Learning log**: `learning.ts`, `components/Learning.tsx`, `store.addLearning…`, prompt hook in `App.tsx` (`learnPromptFor`).
- **Win jar**: `winjar.ts`, `components/WinJar.tsx`. **Share my week**: `shareWeek.ts`, `shareText.ts`, button in `WeekSummary.tsx`.

## Judgement calls

- **11:00 rule vs the weekly targets**: with the morning slot gone, weekday evenings and weekends carry the week, so a week with several evening events can leave an area one session short; that is *reported* by the targets card, not hidden. The old "normal week reaches every target" test now asserts "met or exactly reported" (and Meditation, which used the morning slot, still gets all 3). Other test fixtures that describe the old planner run with `earliestAuto: "00:00"` (`tests/_early.ts`).
- **Clear**: a line only counts as the command when every leftover word is filler ("clear the garage" stays a task). Phone-calendar events can't be moved by the app: the only choice is Keep or Hide for today. Own events: Keep only (edit them to move them). Bills, chores and tasks you timed: Keep (default) or Move (uses the existing "Not sure" reschedule). Tasks the app places by itself move because the planner re-plans around the block, then the existing overflow reshuffle settles what cannot stay today. Items whose destination the planner cannot find are shown as "no room this week" and appear in "This week's targets" if they are sessions.
- **Capacity**: the load that counts is what the planner *chooses* (sessions, your own tasks); bills, chores and life admin keep their own days and are neither learned from nor capped. Overdue tasks and life admin are never held back. Minutes cap = max(median minutes, 90).
- **Other**: logged time that names a tracked area ("did 1 hour of power bi") becomes a session of that area, never Other. A typed duration line is treated as a log only when it starts with a duration or a verb like spent/worked/did, and has no time-of-day or "tomorrow/next/at" in it. Default minutes when an item has no estimate: task 20, repeat 15, bill 10, chore 20, event = its length.
- **Alarms**: the night-before button exists for events (own or phone-calendar ones tagged #today-remind, and any own event starting before 08:00). A task you timed before 08:00 gets the button on its sheet only (it has no night-before notification, and none was added).
- **Learning prompt**: shows only for a session finished in the last 5 minutes, today, not backdated; a restore from a backup never prompts.
- **Win jar**: "tasks done" = own tasks and repeats + Gmail tasks + life admin; logged time counts as a task done. Slow-day trigger "yesterday under 50%" = sessions planned yesterday plus tasks due yesterday, at least two of them.
- **Share my week**: after the share sheet closes normally the text is not tracked; nothing is marked.
