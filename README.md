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
- `lib/schedule.ts`, `sessions.ts`, `fixed.ts`, `bills.ts`, `nudges.ts`, `ai.ts`: the session / event / bill / nudge logic (pure, tested)
- `lib/planday.ts`, `rescue.ts`, `checkin.ts`, `balance.ts`, `stats.ts`: task planning logic (pure, tested)
- `lib/notifications/plan.ts`: decides every notification (pure, tested); `native.ts` schedules them on Android
- `lib/events/`: curated London events (offline); a live-source interface is ready for later
- `android/…/TodayNativePlugin.java`: share-to-Today, icon shortcuts, battery-optimisation status
- `scripts/generate-icons.mjs`: regenerates the PWA icons in `public/`

## Roadmap (structure is ready, not built)

Live London events APIs · optional AI · optional Supabase sync (swap the `StorageAdapter` in `lib/store.ts`).
