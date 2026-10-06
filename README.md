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
- `lib/planday.ts`, `rescue.ts`, `checkin.ts`, `balance.ts`, `stats.ts`: planning logic (pure, tested)
- `lib/notifications/plan.ts`: decides every notification (pure, tested); `native.ts` schedules them on Android
- `lib/events/`: curated London events (offline); a live-source interface is ready for later
- `android/…/TodayNativePlugin.java`: share-to-Today, icon shortcuts, battery-optimisation status
- `scripts/generate-icons.mjs`: regenerates the PWA icons in `public/`

## Roadmap (structure is ready, not built)

Live London events APIs · optional AI · optional Supabase sync (swap the `StorageAdapter` in `lib/store.ts`).
