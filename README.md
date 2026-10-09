# Today · Sahil's Today

A calm, local-first task app, **created by Sahil**. Next.js + TypeScript + Tailwind. No backend, no accounts;
your data stays on your device. Runs as a website / installable PWA (Vercel) **and** as an Android app (Capacitor).

```bash
npm install
npm run dev            # http://localhost:3000 (service worker disabled in dev)
npm test               # unit tests (parser, recurrence, planner, notifications, …)
npm run build && npm start   # production web build, with offline support
```

Deploy the web version: push to GitHub and import the repo into Vercel (free tier, zero config).

## Android app

See **[ANDROID_SETUP.md](ANDROID_SETUP.md)**: step-by-step, written for someone new to Android Studio.

```bash
npm run android:build   # static export -> ./out, then copies into ./android
npm run android:open    # open in Android Studio
npm run android:apk     # debug APK from the command line (needs Android Studio's SDK)
```

The web build and the Android build come from the same code; only `BUILD_TARGET=android` (set by the script)
switches Next.js to a static export.

## The simple version (after the polish)

Open it and you see **what's next** (Start / Done / Snooze), your top must-have as one line, then **the day as one timeline**.
The input is at the bottom: type or speak anything. One button, **Adjust my day**, rebuilds today around how much time and energy you have.

- **Menu** has five things: Calendar, Shopping list, Bills & chores, Must-haves, Settings (backup and appearance live in Settings).
- **The timeline** (`lib/timeline.ts`) puts everything with a time in its exact place and fits everything else into the best free gap.
  No overlaps, 10-minute buffers, a protected 17:00-18:00 tea/food break on weekdays, an evening capped at about 2.5 hours
  (lighter on office days, Monday by default, with the commute counted), and overflow moves to the next day with room.
  Add "fill form at 3pm" and anything that had to shift says so in one line ("Moved Power BI to 18:30 to fit your form").
- **Pending work can't pile up**: overdue things are placed first and marked "carried over"; a task can be snoozed twice, the third time
  you choose (do it now for 15 min / fixed slot / drop). Three or more overdue, or behind on targets, and the morning card offers a
  one-tap catch-up plan. The Sunday review makes you decide on everything still pending.
- **Calendar**: week and month views, plus a read-only copy of your phone's calendar (Android Calendar Provider, offline, asked once;
  Settings → Calendar). Open an `.ics` invite with "Today", or share/select text in any app, and it lands in the input.
- **Night mode**: after 23:00 (Settings → Night mode) home only says "Time to sleep. Tomorrow starts with: …" and keeps the input.
- **Understanding**: an offline dictionary of 500+ words and phrases (English, Hinglish, Devanagari; `lib/words.ts`) tested on 1900+ generated
  phrases (`tests/phrases.test.ts`). Words it doesn't know: it asks "Add to my dictionary?" and learns on the device. Gemini handles the rest.
- **Voice**: with a Gemini key the phone records you (native, 16 kHz WAV) and Gemini writes down what you said, shown editable before saving.
  Offline or without a key it falls back to Android's recogniser (English India, patient with pauses). Settings → Voice hides the mic.
- **Session numbers**: Settings → Areas → "Next session is number" (Power BI at 14). Weekly dots stay separate.
- **On pace**: "This week 72% · On track / Slightly behind", judged against what's expected by today's weekday.

## Next level (plan: NEXT_LEVEL_PLAN.md)

**Home & taps.** A **Coming up** strip under the timeline shows tomorrow, the day after and day 3 (the first few items, fixed things first with
times), built from the same `buildTimeline` as the planner; tap a day to open the Calendar on it. A **Calendar** button sits next to Menu.
Every notification now lands on its own card (`lib/tap.ts`): a session / chore / bill opens its Start / Done / Snooze sheet, an event opens the
event, a nudge opens the week, and "Already done 👍" if it's gone. A tap from a closed app waits for the data to load.

**Timers stop on time** (`lib/timer.ts`). Start on a session runs for that area's minutes (Meditation 15, Power BI 60); on a task for its estimate;
on a chore or bill for its block. The bar counts down ("12:41 left") with a thin progress bar. At zero it vibrates, chimes and counts the session
("Meditation session 8 done, Sahil 🌿"), or asks "Done?" for a task. An exact alarm is scheduled for the end, so it rings with the screen locked, with
**Done** and **+5 min** on the notification; stopping early cancels it. No goal: it counts up, asks "Still going?" at 60 minutes and stops at 3 h.

**How are you feeling?** (`lib/feeling.ts`). The morning ping (08:15 weekdays, 09:30 weekends, Settings → Daily rhythm, with an on/off switch) opens a sheet:
pick Low / Okay / Great, then tick what today holds. Booked things are locked; **you choose**. A realistic set is pre-ticked with one line of why.
**Make it work** keeps the ticked things today and moves the rest to the next days with room (`firstDayWithRoom`, the weekly session planner, the
two-off-days rule) and says what moved. A banner on Today asks before 11:00 until it's answered.

**Quotes** (`lib/quotes/`, `lib/quoteBag.ts`). 1000 English (attributed only where the attribution is certain) and 1000 original Hinglish lines in
8 moods. A notification every 1 / 2 / 3 days (default every 2, 13:30, never in quiet hours; alternates English and Hinglish, big-text style).
A quote never repeats until all have been used: the shuffled order comes from a stored seed, each date is pinned once shown. Tap → a calm
full-screen card with ♥ Save and Another one; saved quotes are under Menu → Quotes.

**Learns your rhythm** (`lib/capacity.ts`, `lib/load.ts`). From the last 8 weeks (sessions, chores, completed tasks, check-ins): what you
usually finish per weekday and per energy, and where each area's sessions really happen. Nothing is used until there are 10 days ("Learning your
rhythm · 6 of 10 days"). It sets the check-in pre-ticks, offers an area's real slot first (only among slots you allowed; never over an exact
time or when "Keep my time order" is on; said once in a note), and tells you plainly when a day is far more than you usually finish ("Pick what matters").

**Sunday coach letter** (`lib/coach.ts`). A short, honest, warm letter: what went well, what slipped and the likely reason, one small change. With
a Gemini key it's written from a compact summary (titles and counts, never notes); otherwise, offline or on any error, a rule-based letter from the
same summary. One per week, cached (last 12 kept), shown at the top of the weekly review.

**Home-screen widget** (Android). Add the "Today · Next up" widget: small = Next up with **Start** and **Done**; stretch it for the next two things
and this week's %. The app saves a small JSON snapshot (`lib/widget.ts`) whenever data changes, on resume and at the day roll-over; the widget picks
"Next up" by the clock, refreshes at each item's start/end and at midnight. Done hides the item at once and is applied by the app through the
normal actions on the next open (so sessions are counted properly). Start opens the app into that item with its timer running.

## Sessions, events, bills and nudges

**Sessions.** Areas have weekly targets (Settings → Areas & weekly targets): Power BI 4×60 min, Meditation 3×15, Job Prep &
Apply 5×40 (alternating), English Reading daily 20, Walking ~daily 35. The planner (`lib/schedule.ts`) spreads each week's
remaining sessions across the free days and your time slots (Before work / Evening / Build time), keeps weekends light, and
re-plans whenever something changes. Sessions count automatically: "Power BI session 14".

**Fixed events.** Type `event Wednesday 6pm dinner` (or `event shanivar shaam 6 baje dinner`). It's a block that never moves;
sessions that no longer fit shift to the next free days, still aiming at the weekly targets. An outing counts as the walk.

**Bills and chores** (Settings → Bills & chores): rent due on the 1st, paid in cash, reminds 3 days before (the 28th, or the
29th in a 31-day month); credit card on the 15th; mobile on autopay (never reminds); clean room every 3 days; weekend
grocery run and finance review; a weekly call to family. All editable.

**Shopping list.** You fill it (`groceries: milk, sugar`, or Menu → Shopping list). Nothing is added for you. The Saturday
grocery reminder reads it out.

**Nudges.** One gentle nudge a day: tomorrow looks empty, an area has been neglected ("No meditation in 5 days"), or a weekly
target can't be reached any more. Sunday review, monthly must-haves pinned on Today, "Getting bored?" ideas, and a backup
reminder every two weeks.

**Check-ins.** Midday nudge, wrap up work, "Have you sorted your email, Sahil?", and the 22:00 "Did you do today's
sessions?". Notifications have **Done / Snooze / Skip**; all times and on/off switches are in Settings → Daily rhythm.

**Optional Gemini.** Settings → Smart parsing. A free Google AI Studio key lets Gemini fill gaps (a missing date, an unclear
area) only when the built-in rules are unsure. Offline or on any error, the rules answer is used. The key stays on the device
and is not in your backup. Defaults are applied once per install (`lib/seed.ts`); anything you change sticks.

## One button: type or say anything

The home screen is the ring on top, one big input (with a mic), and today's list. Everything else is in the menu.
Whatever you type or say is understood and filed (`lib/understand.ts`), in English, Hinglish or Hindi:

| You say | It does |
|---|---|
| `did Power BI`, `meditation kiya`, `kal walk kar li` | counts the session ("Power BI session 15") |
| `milk khatam`, `need sugar`, `doodh lana hai` | straight to the shopping list |
| `event Wednesday 6pm dinner`, `movie friday 8pm` | a fixed block; sessions re-flow around it |
| `paid rent`, `rent bhar diya` | marks the bill paid |
| `reply starred email` | Work, at your email time (20:00), not "Later" |
| `pay electricity bill friday` | Finance, that day |
| `idea: a habit app` | Ideas & Notes |

After every capture a "Got it: Reply to starred email · Work · today 20:00" card appears. Tap the area or the time to
fix it, and it remembers that fix next time, offline too (Settings → What I've learned).

**Two brains, one pipeline.** Offline rules (`lib/dictionary.ts`: ~18 categories of English, Hinglish and Devanagari keywords)
always work. With a free Gemini key (Settings → Smart parsing) Gemini reads your profile, rhythm, bills and today's schedule and
answers in JSON; it must be confident, every field is validated, a typed date or @area always wins, and on any problem
(offline, slow over 5 s, rate-limited) the rules answer silently. Your learned fixes win over both. The key is stored only
on the device (never in code, logs or backups).

**Off days.** Up to 2 a week (Mon–Sun). An off day keeps one short session (≤ 20 min) and spreads the rest across the
remaining days. After 2, the button disables.

**Progress.** One ring ("This week: 72%"), dots per area, your streak (off days don't break it), one kind line a day.

## Capture syntax

`kal shaam 6 baje mummy ko call karna hai !`  ·  `Report by end of this week #work ~1h30m @work`  ·  `har somvar gym`
· `office ke baad gym bag pack` · `Plan Lisbon /trip next Friday`

- Dates: English (chrono-node) and Hinglish / Devanagari (`lib/hinglish.ts`): aaj, kal, parso, weekdays,
  subah/shaam/raat, "5 baje", tak, "mahine ke end tak", "weekend pe", …
- `!` important · `#tag` · `~30m` estimate · `@area` life area · `/trip` etc. template
- Repeats: every Monday, daily, weekdays, every 1st, har somvar, roz…
- Personal phrases from **Me** ("office ke baad" = after your work hours + commute, "lunch mein", your own)
- No date understood → Later; tap **Set date**

## Where things live

- `lib/store.ts`: the single data store. `localStorage` on the web, Capacitor Preferences in the Android app.
- `lib/parse.ts`, `hinglish.ts`, `recur.ts`, `profile.ts`: capture parsing
- `lib/timeline.ts`, `busy.ts`, `settle.ts`, `adjust.ts`, `pileup.ts`, `pace.ts`, `calendar.ts`, `teach.ts`: the day timeline and its rules (pure, tested)
- `lib/schedule.ts`, `sessions.ts`, `fixed.ts`, `bills.ts`, `nudges.ts`, `ai.ts`: the session / event / bill / nudge logic (pure, tested)
- `lib/planday.ts`, `rescue.ts`, `checkin.ts`, `balance.ts`, `stats.ts`: task planning logic (pure, tested)
- `lib/tap.ts`, `timer.ts`, `feeling.ts`, `capacity.ts`, `load.ts`, `coach.ts`, `quoteBag.ts`, `widget.ts`: the next-level features (pure, tested)
- `lib/notifications/plan.ts`: decides every notification (pure, tested); `native.ts` schedules them on Android
- `lib/events/`: curated London events (offline); a live-source interface is ready for later
- `android/…/TodayNativePlugin.java`: share / select-text / .ics intents, phone calendar reader, audio recorder, vibration, battery status, widget bridge
- `android/…/TodayWidgetProvider.java`: the home-screen widget (draws the snapshot; no planning logic)
- `scripts/generate-icons.mjs`: regenerates the PWA icons in `public/`

## Roadmap (structure is ready, not built)

Live London events APIs · optional AI · optional Supabase sync (swap the `StorageAdapter` in `lib/store.ts`).
