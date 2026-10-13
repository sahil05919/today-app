# Today: owner's guide

Written in plain English, for you. Nothing here needs Claude. If you ever hand the app to another developer or an AI, give them this file and `NOTES-assistant.md`.

---

## 1. What the app is

A calm to-do and planning app that lives on your phone (Android app, built with Next.js + Capacitor). Everything is stored **on the phone**. There is no server and no account. Google Calendar is used for two optional extras (a safety copy of your plan, and a way for the Gmail add-on to send you tasks).

## 2. What each part does, and where its settings are

Open **Menu (☰, top right) → Settings** for almost everything. Each heading below is a section in Settings.

| Part | What it does | Where to change it |
|---|---|---|
| **Today** (home screen) | One timeline for the day: your sessions, tasks, bills, events. "Next up" has Start / Done / Reschedule. | Nothing to set; it plans itself |
| **Capture bar** (bottom) | Type or speak anything: "call the bank Friday 3pm". The app works out the date, time and area. | Settings → Smart parsing (optional Gemini key), My phrases |
| **Sessions and areas** | Weekly targets such as "Power BI 4 a week". The planner places them in free time. | Settings → Areas & weekly targets |
| **Daily rhythm** | Times for check-ins, quiet hours, night mode. | Settings → Daily rhythm, Night mode |
| **Work and commute** | Work days/hours, commute, lunch, tea break. | Settings → Work, Planning rules |
| **Repeating tasks** | Everything that repeats. | Settings → Repeating tasks |
| **Life admin / side work** | Laundry, haircut, side-work check. Each can be switched off. | Settings → Life admin |
| **Bills & chores** | Reminders N days before, none for autopay. | Menu → Bills & chores, or Settings → Bills & chores |
| **Notifications** | Permissions, battery, what you want to hear about. | Settings → Notifications |
| **Calendar** | Show your phone calendar as fixed blocks; write events you create to Google; the **Plan mirror**; the Inbox calendar. | Settings → Calendar |
| **Backups** | Weekly file backup to the phone's Documents folder. | Settings → Backups |
| **Backup & data** | Export / import a JSON file by hand. | Settings → Backup & data |
| **App notes** | Anything you type as `app: …` in the capture bar. | Settings → App notes |
| **Health** | The morning self-check, and **Recent errors**. | Settings → Health |
| **Weekly review** | Sunday letter, "Week so far" on Friday. | Menu → Weekly review |
| **Lighten my week** | Finished early? Pulls work forward. Type "I'm free" or "work done". | Capture bar, or Today's card |

### Things worth knowing
- **Done** is instant and is saved about a third of a second later. If the phone is switched off at that exact moment, the last tap could be lost. Leaving the app saves immediately.
- **Back button** closes the top sheet only. With nothing open it puts the app in the background.
- A **notification tap** closes anything that was open and shows the thing the notification was about.

## 3. Build and install

You need Android Studio installed (it holds the SDK). All commands are for **PowerShell**, run from the project folder (`C:\Users\mahes\old\Desktop\today-app`).

**One-time:** `npm install`

**Run the tests and checks**
```powershell
npm run typecheck
npm test
npm run build
```

**Build the fast release app (recommended)**
```powershell
npm run android:release
```
This makes the web build, copies it into the Android project, builds the release APK, checks its signature, and prints the file path:
`android\app\build\outputs\apk\release\app-release.apk`

**Install it on the phone** (USB cable, USB debugging on, phone unlocked). `-r` means "replace", which keeps all your data:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "C:\Users\mahes\old\Desktop\today-app\android\app\build\outputs\apk\release\app-release.apk"
```
Check the phone is seen first with: `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices`

**Other way, with no command line:** run `npm run android:build`, then `npx cap open android` to open Android Studio, pick your phone at the top, and press the green **Run ▶** button.

**Debug build** (slower, for development): `npm run android:apk` → `android\app\build\outputs\apk\debug\app-debug.apk`.

### If the build fails
- **"Unsupported class file major version 69"**: Gradle was started with Java 25. `scripts/jdk.mjs` picks Java 21 from `C:\Users\mahes\.jdks` automatically. If you ever delete that folder, install JDK 17 or 21 and set `TODAY_JAVA_HOME` to its folder.
- **Phone not listed by adb:** unlock it, accept the "Allow USB debugging" prompt, try another cable/port.
- **"INSTALL_FAILED_UPDATE_INCOMPATIBLE" / signature mismatch:** see section 4.

The release app is signed with the **same debug key** as every earlier build (`C:\Users\mahes\.android\debug.keystore`). That is why it installs over the old one. `npm run android:release` prints a line confirming the two certificates match. **Never delete that keystore file**: without it, an update can't install over your data.

## 4. Backups and restoring

There are three layers.

1. **Weekly file backup (automatic).** Every Sunday at 21:30 the phone writes `today-YYYY-MM-DD.json` to **Documents/TodayBackups**. The last 8 are kept. This folder is **not deleted when you uninstall the app**. If a Sunday was missed, the app makes one the next time it opens. Look at **Settings → Backups** (it lists them, has *Backup now*, *Restore*, and *Share* to Google Drive or email).
2. **History archive.** Raw history older than 8 weeks is moved to `today-history-YYYY-MM-DD.json` in the same folder (the weekly reviews keep their numbers). Only the history archive uses these files; you never need to restore them.
3. **Google Calendar "Today – Plan"** (section 5): your next 7 days, readable on any device.

**Manual export/import:** Settings → Backup & data → *Export JSON* / *Import JSON*. Importing **replaces** what is on the phone. Restoring from the Backups screen always writes a safety copy first (`today-pre-restore-….json`).

**After a reinstall or a new phone:** install the app, open Settings → Backups, pick the newest `today-….json` and Restore. If the list is empty (Android hides files from a previous install), use *Import JSON* and choose the file from Documents/TodayBackups with the Files app.

### Signature mismatch
Android refuses to install an app over another one that was signed with a different key ("INSTALL_FAILED_UPDATE_INCOMPATIBLE" or "signatures do not match"). This only happens if the key changed. What to do:
1. In the old app, **Backup now** (Settings → Backups) and also *Export JSON*. Copy the files off the phone if you can.
2. Uninstall the old app: `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" uninstall com.sahil.today`
3. Install the new APK, then restore from the backup (above).
Your Documents/TodayBackups files survive the uninstall.

## 5. Google Calendar: the safety copy and the Gmail add-on

Android apps cannot create a calendar that syncs to Google. So **you** create two calendars once, in Google Calendar **on the web** (calendar.google.com → "Other calendars" + → "Create new calendar"), in the same Google account that is on the phone. The app finds them **by name**. The dash is an en dash, but a normal hyphen works too.

### "Today – Plan" (the app writes it)
- Turn it on in **Settings → Calendar → Plan mirror** (on by default). Allow calendar access when asked. The status line says what is happening. If the calendar is missing, Settings and the Health card say: *Create a calendar named 'Today – Plan' in Google Calendar (web) to turn on your safety copy.*
- It holds the **next 7 days**: sessions, tasks, life admin, bills, events you typed. It leaves out Commute, Lunch, Tea break and the daily rhythm pings.
- Titles: `📊 Power BI session 4`; done → `✓ 📊 Power BI session 4`; skipped → `✗ …`. Timed items keep their time. Flexible to-dos are all-day events called `To-do: …`. The notes say area, duration, and *"Managed by the Today app — edits here are overwritten"*.
- It only changes what changed (adds, edits, removes). It never wipes and rewrites. A day that has finished is written one last time with its ✓/✗ and then never touched again, so it becomes your history in Google.
- It runs after changes (a moment after you stop tapping), on the first open each day, and at about 06:00 each day.
- **Tip:** in Google Calendar settings for "Today – Plan", set the notifications to **None**, so you are not alerted twice (the app already reminds you).
- **Limit:** at 06:00 the phone moves the window forward from the last plan the app saved. Android can't run the planner without opening the app, so if you haven't opened it for days, newly planned items appear when you next open it.
- The app **never reads these two calendars back as events**, so nothing gets duplicated.

### "Today – Inbox" (the Gmail add-on writes it, the app reads it)
The Gmail add-on and its nightly Google Apps Script talk to the app **only** through this calendar.

| The script creates | What the app does |
|---|---|
| An event titled `TASK: Reply to Pinnacle about shift`, on the due date. Optional lines in the notes: `area: Job`, `time: 14:00`, `duration: 20`, `important: yes`, `source: <email subject>` | Makes one normal task (once only; it remembers the event), deletes the event from the Inbox, and shows "1 task added from Gmail". An unknown `area` is left for the normal classifier. |
| An event titled `DIGEST: 3 emails need you`, today's date, 20:00. Notes: one email per line, `• Sender — Subject — reason` | From 19:00 Today shows an **Emails that need you** card (tap to open the list, ✕ to dismiss). The 20:00 evening check-in says "…3 emails need you". The app never deletes digests, so the script should clean them up. Only today's digest is shown. |

### `#today-remind`
Events the add-on puts in your **main** calendar (shifts, bookings) carry `#today-remind` in their notes. For those the app sends reminders 2 days before at 19:00, the evening before at 21:00 and 1 hour before. It checks for a clash with work hours (a card appears on Today with *Adjust work start* / *Keep anyway*), and the day re-plans around them. Other calendar events behave as before (they block time but have no reminders from Today).

## 6. When something breaks

1. Open **Settings → Health → Recent errors**. It lists the last 50 problems the app noticed, each with the time, where it happened and the message. Tap **Copy**.
2. Paste that into a message to any AI or developer, with:
   - **What you did** (the exact taps), **what you expected**, **what happened instead**;
   - **When** (date/time, so it can be matched to the log) and whether it happens every time;
   - Which build: *release* or *debug*, and the Android version.
   - For a feeling like "it was slow/stuck", say how long, and what was open.
3. If the screen shows **"Something went wrong — Reload"**, tap Reload. Your data is saved first. Then do step 1.
4. If it feels stuck: leave the app (Home), and open it again. A stuck app should now be rare because every phone call has a 5-second limit and saves happen in the background.
5. Ideas, complaints, "this reminder feels too early": type `app: …` in the capture bar. They collect in Settings → App notes; *Copy all* gives you a bullet list to paste.

Developer tip: in a browser (`npm run dev`), type `__todayTiming()` in the console to see timings for open, planner, sync and saving.

## 7. Map of the code (for a future developer)

```
app/            Next.js shell (layout, page, manifest). page.tsx wraps <App/> in an error boundary.
components/     The screens. App.tsx is the root; NativeShell.tsx is Android-only plumbing;
                ui.tsx holds Sheet (every popup goes through it); TodayView/Timeline = the home screen;
                ProfileSheet = Settings; InboxCards = Gmail digest + clash cards.
lib/            All logic, mostly pure functions (no React):
  store.ts        The data store (all actions). Debounced saving, change version.
  types.ts        The data shapes. backup.ts: the loader/"cleaner" (every new field must be added there).
  timeline.ts, schedule.ts, busy.ts   The planner: one day as a timeline, sessions into free slots.
  series.ts       Repeating tasks (computed, never generated ahead).
  syncPipeline.ts + syncSteps.ts      THE single place for side effects (reminders, Plan calendar,
                                      Inbox, widget, backup check, history compaction).
  notifications/  plan.ts decides what to notify; native.ts talks to Android.
  mirror.ts / mirrorRun.ts            "Today – Plan": what to write, and the diff.
  inbox.ts / inboxRun.ts              The Gmail add-on contract (TASK:, DIGEST:, #today-remind).
  dayCapacity.ts  What you really finish in a day (the planner's caps).
  clear.ts / clearParse.ts   The "clear" command: words → windows, preview, apply.
  other.ts / workLog.ts      "Other work" and logging time by typing. progress.ts: the minutes-based percentage.
  earlyAlarm.ts / earlyAlarmRun.ts   One-tap alarms for early starts.
  learning.ts / winjar.ts / shareWeek.ts   Learning log + post draft, win jar, "Share my week".
  sheetStack.ts   The one manager for sheets (z-index, backdrop, Back button, scroll lock).
  nativeBridge.ts Every call into the Android plugin, each with a 5-second limit (nativeGuard.ts).
  debugLog.ts     The "Recent errors" log.   compact.ts: history older than 8 weeks.
tests/          Vitest tests (`npm test`). *.test.tsx files use a fake browser (jsdom).
android/        The Android project. app/src/main/java/com/sahil/today/:
                TodayNativePlugin.java (calendar, backups, widget, recorder), BackupStore.java (weekly files),
                MirrorStore.java (Plan calendar), BackupReceiver.java (the Sunday 21:30 and daily 06:00 alarms).
scripts/        android-build.mjs (npm run android:release), verify-signature.mjs, jdk.mjs.
NOTES-*.md      Earlier code maps and design decisions. Read NOTES-assistant.md first.
```

Rules of the house: new data fields go in `types.ts` **and** `backup.ts`; nothing talks to Android except through `nativeBridge.ts`; nothing schedules reminders or calendar writes except through the sync pipeline; every sheet is a `<Sheet>`.

## 8. The final feature pass: what each new thing does and where its settings are

All of these live in **Menu (☰) → Settings** unless it says otherwise.

| Feature | What it does | Settings |
|---|---|---|
| **No planning before 11:00** | The planner never places anything automatically before 11:00 on any day (the old 8–9 morning slot is gone; Meditation and the others move to later free time). Things you timed yourself (a 09:00 dentist, a 07:00 shift, phone-calendar events) stay exactly where you put them. "Reschedule → Tomorrow morning" means the first free slot from 11:00. No default check-in or session ping is sent before 11:00; the 09:30 brief stays (only if you haven't opened the app). | Planning rules → **Earliest auto-planning time** |
| **Clear command** | Type `clear until 7pm`, `clear rest of today`, `clear tomorrow`, `clear tomorrow morning`, `clear 13 oct 2-4pm`, `clear wed evening`, `clear 2 to 4`, `aaj 7 baje tak clear`, `kal clear karo`. As soon as you type "clear" chips appear (Clear rest of today / Clear until … / Clear tomorrow / Clear a time range…). A **preview** shows what will move and where, and what is fixed in that window (phone-calendar events, tasks you timed, bills) with Keep (default) or Move / Hide for today. Nothing changes before **Confirm**. Then the time shows on Today as a muted "🧹 Cleared" block that the planner will not refill; tap it to put it back. The toast has **Undo**, which restores everything. "clear the garage" (anything that isn't a time) is still just a task. | none |
| **Plan to what I really finish** | From the last 28 days the app works out how many flexible things (and minutes) you really finish on a weekday and on a weekend (the median; off days and cleared days are ignored). The planner never gives a day more than that (never fewer than 2 items), and the extra goes to lighter days. Weekly targets stay a hard rule: what cannot fit is shown in "This week's targets" ("Power BI: 2 of 4 fit"), never dropped quietly. Until 14 days of history exist it uses the old limits. | Planning rules → one quiet line ("Planning about 3 items on weekdays, 4 on weekends…") and **Items a day (0 = Auto)** |
| **Set alarm** | For anything that starts before 08:00 (a 07:00 shift, an early event, a task you timed): a **Set alarm** button on its sheet, and on the night-before 21:00 reminder, makes a real alarm in your clock app, "wake-up lead" minutes before (default 90: a 07:00 shift rings at 05:30). Android alarms have no date, so the button appears within 24 hours of the alarm time ("Available the evening before" until then). Afterwards the item shows "⏰ alarm set 05:30". | Planning rules → **Alarm lead before an early start** |
| **Learning log** | After a Power BI session is done (or its timer ends) a small prompt asks "What did you learn?" (one line, Save / Skip). **Menu → Learning log** lists them by date (edit, delete, Copy all, Share). With 5 or more unused learnings the Sunday review shows "You have 8 learnings — turn 3 into a LinkedIn post?": a draft built offline (hook, bullets, short close, at most 2 hashtags), an optional **Polish with Gemini** (only the chosen lines are sent, nothing is stored), Copy and Share. Sharing (or "I posted it") marks those learnings used. | **Learning log** (which areas ask; Power BI by default) |
| **Win jar** | On a slow day (after 18:00 with less than half done, or yesterday under 50%, or an off day / skipped session today) a quiet card shows your three strongest numbers from the last 30 days. Once a day, dismissible, never a notification. **Menu → Win jar**: this month against last month, best streaks, your biggest week. | none |
| **Share my week** | On the Sunday review, **Share my week** builds a short friendly text (done/target per area with ✅, Other, tasks finished, a highlight, next week's focus) and opens the share sheet. The app never sends anything itself. | **Accountability** (on/off, buddy name for "Hey Rahul, my week:") |
| **Other work** | The week view (This week) has an **Other** row after the five areas: everything productive that isn't a tracked area: your own tasks, repeats and life admin, Gmail tasks, bills and chores, calendar events you ticked, and logged time. Tap it for the breakdown by Building / Chores / Admin / Learning / Other (labels are guessed from the words and can be changed). **Log time you already spent** by typing `spent 2 hrs building the app`, `2h app build`, `worked 45 min on CV`, `did 1 hour cleaning`, `aaj 2 ghante app pe kaam kiya`, `yesterday spent 90 min on forms` — it is saved straight away as done (never a to-do), with a toast and **Undo**. The percentage is measured in minutes: each area up to its own target, Other up to its weekly hours; time beyond a target is shown as a bonus ("+2h extra 💪") and never pushes the percentage past 100. | Planning rules → **Other work target (hours a week)** (default 5; 0 = none) |

**Phone permission added:** `com.android.alarm.permission.SET_ALARM` (a normal permission: Android does not ask).

### Data and updates
This version stores a few new things (cleared stretches, logged time, learnings, notes, alarm marks). The app's data version is now **4**. The first time it opens it copies your old data to a safety key (`today:v1:backup-pre-v4`) and then continues; doing it twice changes nothing. The weekly file backups include everything.
