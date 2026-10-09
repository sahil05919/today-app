# Today · next-level plan (for Claude Code)

You are working on Sahil's "Today" app (Next.js + Capacitor Android, local-first, £0, no backend).
Do everything below **in 4 stages, in order**. Be economical: this codebase is large (~13.7k lines), so don't re-read it all.

## How to work (read this first)
1. Read `README.md`, `POLISH_PLAN.md` and `lib/types.ts` once. Then use grep / targeted reads for anything else. Do not read `lib/words.ts`, `lib/dictionary.ts` or `lib/events/curated.ts` in full.
2. **Reuse what exists. Don't rebuild it.** The relevant pieces are already here:
   - Timeline and next-up: `lib/timeline.ts` (`buildTimeline`, `nextUp`), `components/Timeline.tsx`, `components/TodayView.tsx`
   - Calendar: `components/CalendarSheet.tsx` (week/month views, already built, only hidden in the Menu)
   - Adjust my day: `lib/adjust.ts` (`planAdjust`, `applyAdjust`, `Energy`), `components/AdjustSheet.tsx`
   - Moving things to days with room: `lib/settle.ts`, `lib/pileup.ts` (`firstDayWithRoom`), `lib/schedule.ts` (`planSessions`)
   - Timer: `settings.timer` (already has `goalMin`), `components/TimerBar.tsx` (`finishRef` logs sessions/chores/bills)
   - Notifications: `lib/notifications/plan.ts` (pure, decides everything), `lib/notifications/native.ts` (schedules; `TapTarget`, `listenForActions`; `extra` already carries `kind`, `key`, `ref`, `taskId`)
   - Tap routing: `onNotificationTap` in `components/App.tsx`
   - Gemini: `lib/ai.ts` (key, auto model, timeouts, `explainFailure`). Reuse those helpers. Never put the key in code, logs or backups.
   - History: `data.sessions` (SessionLog with `at`), `data.log` (DayEntry), `tasks[].completedAt`, `lib/stats.ts`, `lib/progress.ts`, `lib/pace.ts`
   - Native: `android/.../TodayNativePlugin.java`, `lib/nativeBridge.ts`
3. New logic goes in **pure, tested** files in `lib/`, like the rest of the codebase. UI stays thin.
4. New data fields are **optional** in `AppData` / `Settings` / `Profile`, with defaults through `lib/profile.ts` / `lib/seed.ts` (bump `SEED_VERSION` only if needed). Add a non-destructive step to `migrate` in `lib/backup.ts` if any shape changes. Include new data in the JSON backup.
5. Only consult `node_modules/next/dist/docs/` (per AGENTS.md) if you touch Next-specific APIs (routing, config, metadata). Plain React components don't need it.
6. Don't run the full test suite after every edit. Run `npm run typecheck` + `npm test` **once at the end of each stage**, fix what breaks, and move on. Run **one** production build and **one** `npm run android:apk` at the very end. Put the APK in `apk/`.
7. Keep the app calm and simple: one banner at a time, no new clutter on the home screen beyond what's described here. Match the existing tone ("{name}", short kind lines) and Tailwind tokens (`bg-accent-soft`, `btn.primary` etc. from `components/ui.tsx`).
8. Things you can't verify without the phone (widget look, alarm when locked, notification taps): build them to fail soft and list them in your final notes for Sahil to test.

---

## Stage 1 · Quick fixes

### 1a. "Next 3 days" on the home screen
- Under the timeline in `TodayView`, add a compact strip: **Tomorrow · Day after · Day 3**. Each shows the date, the count of items and the first 2–3 titles (fixed events first, with times). Build it from `buildTimeline(data, day, …)` for each day, so it matches what the planner will really do.
- Tapping a day opens `CalendarSheet` on that day. Add a small **Calendar** icon button in the header next to the Menu button that opens `CalendarSheet` directly. It stays in the Menu too.

### 1b. Notification tap opens the exact thing
Today only `taskId` taps work. Every kind should land on its own card:
- `session` / `slot` / `chore` / `bill` → that day's timeline item sheet (`ItemSheet`, with Start / Done / Snooze). Find the item by `key` / `ref` in today's timeline (or the notification's day).
- `event` → `EventSheet` for that event.
- `nudge` → progress sheet. `review` → Weekly review (already works). `wrap` → evening (already works).
- `morning` → the new "How are you feeling?" sheet (Stage 2).
- `quote` → the quote card (Stage 2).
- The sheet state lives inside `TodayView`, so lift it (or pass an "open this" prop down from `App.tsx`) instead of duplicating sheets.
- Cold start: if the app was closed, the tap must still route once data has loaded (queue the target until `data` is ready).
- If the target no longer exists (already done, deleted), show a short toast ("Already done 👍") instead of nothing.
- Add tests for the key/ref → item lookup.

### 1c. Timers stop at the planned time
Bug: a Meditation timer started from Start ran for an hour.
- Starting a timer on a **session** sets `goalMin` = that area's `target.minutes` (Meditation 15, Power BI 60, …). On a **task**, it uses `estimateMin` if set. On a chore/bill, it uses the timeline item's minutes.
- `TimerBar` shows a **countdown** ("12:41 left") and a thin progress bar.
- At zero: stop the timer, vibrate, play the alarm (reuse `AlarmRinger` / alarms), **auto-log** the session (via `finishRef`) or ask "Done?" for tasks, and show a kind line ("Meditation session 8 done, Sahil 🌿").
- **It must work with the screen locked or the app closed.** When a timer starts, schedule an exact local notification for `startedAt + goalMin`, with Done / +5 min buttons. Cancel it if the timer is stopped early. "+5 min" extends `goalMin`.
- No goal (a task with no estimate): count up as now, but ask "Still going?" at 60 min and auto-stop at 3 h.
- Tests: goal resolution per kind, extend, early stop cancels the alarm.

✅ End of stage: typecheck + tests.

---

## Stage 2 · Feel-good and choose-your-day

### 2a. Morning "How are you feeling?" check-in
- Reuse the existing `morning` notification in `plan.ts`. New text: "Good morning, {name}. How are you feeling today?" Default time 08:15 on weekdays and 09:30 on weekends, editable in Settings → Daily rhythm, with an on/off switch.
- Tapping it (or the banner on home before 11:00 if it hasn't been answered) opens one simple sheet:
  1. **Mood/energy**: 😴 Low · 🙂 Okay · ⚡ Great (reuse `Energy` from `lib/adjust.ts`).
  2. **Today's list**: every flexible item (sessions, chores, tasks) with a tick box. Fixed things (events, calendar, bills with a hard due date) are shown locked. **Sahil chooses. The app doesn't decide for him.** Pre-tick a realistic set based on energy and capacity (Stage 3) and say why in one line ("You usually finish about 3 on Fridays").
  3. **"Make it work"** button: ticked items are placed into today's free gaps via the timeline rules. Unticked ones move to the next days with room (`firstDayWithRoom` / `planSessions`), still aiming at weekly targets. Show one summary line ("Moved Power BI to Sunday 18:30, English Reading to tomorrow").
- Reuse `applyAdjust` logic where possible. Don't build a second planner. Record the answer (date, energy, ticked count) in data for Stage 3.
- Tests for: choose → reshuffle respects fixed items, weekly targets and the 2-off-days rule.

### 2b. Quotes that make him feel good
- New data files: `lib/quotes/en.ts` and `lib/quotes/hi.ts` (split into several files of ~250 each if that's easier). Aim for **1000 English + 1000 Hinglish**. Each one is `{ id, text, author?, mood }`, where mood is one of calm / courage / discipline / hope / self-worth / gratitude / focus / bounce-back.
- **English**: well-known quotes **only where the attribution is confidently right**. Skip anything commonly misattributed. Where unsure, include it without an author rather than guessing. Short, uplifting, no clichés repeated.
- **Hinglish**: original lines written for Sahil in natural Roman Hinglish (e.g. "Aaj thoda hi sahi, par kiya toh sahi. Yahi progress hai."), no author. Warm, never preachy, and they must work in any mood, especially a low one.
- Write them in batches to keep it efficient, and add a test that checks counts, **no duplicates** (normalised text), length ≤ 220 chars, and that every mood has some.
- Delivery: a notification **every 2 days** (setting: daily / every 2 days / every 3 days, or off) at a calm time, default 13:30, editable, never in quiet hours. Use Android's big-text style so the whole quote shows. Alternate English and Hinglish.
- **No repeats**: a shuffled bag stored in data. A quote isn't shown again until all have been used. The choice for each planned date must be deterministic so re-planning doesn't change it.
- Tap → a calm full-screen quote card with **♥ Save** and **Another one**. Saved quotes appear under Menu → Quotes (a simple list). Nothing else on home.

✅ End of stage: typecheck + tests.

---

## Stage 3 · Smarter than me

### 3a. Learn real capacity (`lib/capacity.ts`, pure, tested)
From the last 8 weeks of history (`sessions`, `log`, `tasks.completedAt`, morning check-in answers):
- **Per weekday**: the typical number of flexible items actually finished, and the percentage of planned items done.
- **Per area**: when sessions really happen (hour-of-day from `SessionLog.at`) and how long they really take.
- **Energy**: what he actually finishes on Low / Okay / Great days.

Use it in three places, only once there's enough data (≥ 10 days; before that show "Learning your rhythm · 6 of 10 days"):
1. The morning check-in pre-ticks the realistic count and explains it in one line.
2. `lib/schedule.ts` prefers the time slot where an area is really done (e.g. Power BI keeps happening at 8am → offer it there first). An explicit `at` or a slot Sahil set always wins. Mention a shift once in a note, never silently.
3. If a day's plan is clearly more than he usually finishes, the home banner says so plainly and offers "Pick what matters" (opens the 2a sheet).

### 3b. Sunday coach letter
- `lib/coach.ts`: builds a **compact** week summary: sessions vs targets per area, streak, off days, what was moved or dropped, check-in moods, capacity patterns. Titles only, no notes text.
- With a Gemini key: a single call (reuse the `lib/ai.ts` helpers and timeouts, with a longer timeout like the audio one) asking for a short letter (~120–150 words) addressed to Sahil. It covers **what went well · what slipped and the likely reason · one small, specific change for next week**. Honest, warm, never guilt-tripping. Validate it and trim the length.
- Without a key / offline / any error: a rule-based letter from the same summary (templates), so it always exists.
- Generate once per week (Sunday, on first app open or when the review opens), cache it in data (keep the last 12), and show it at the top of `WeeklyReview`. The Sunday review notification says "Your week in a letter is ready, {name}."
- Tests: summary building, the fallback letter, caching once per week.

✅ End of stage: typecheck + tests.

---

## Stage 4 · Home-screen widget (Android)

- A native AppWidget (Java, in the existing Android project, alongside `TodayNativePlugin.java`). Resizable: small = Next up. Medium = Next up + the next 2 items + this week's %.
- Next up shows its title and time, plus **Start** and **Done** buttons.
- **Data flow, no duplication of logic in Java**: the web app computes a small JSON snapshot (next up + next 2 + week %, from `buildTimeline` / `weeklyPercent`) and saves it through a new plugin method to SharedPreferences, then triggers a widget update. Refresh the snapshot whenever data changes, on app resume, and when the day rolls over (also schedule a light refresh at midnight and at each item's start time).
- **Done** on the widget: mark it done in the widget at once, store the action in a small pending queue in SharedPreferences, and apply it in the app on next launch/resume through the normal action (so sessions are counted correctly). **Start** opens the app straight into that item with its timer running (deep link, reusing the 1b routing).
- Match the app's look (colours from the theme; light and dark).

✅ End: typecheck + tests, one production build, one APK in `apk/`. Update `README.md` (short sections for each new feature).

## Final notes for Sahil
Give a short list: what changed, new settings and where they are, and what to test on the phone (widget, locked-screen timer alarm, notification taps from a closed app, quote notification).
