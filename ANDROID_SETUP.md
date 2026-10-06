# Sahil's Today: getting the Android app onto your phone

This guide assumes you've never used Android Studio. Do the parts in order. Part 1 is a one-time setup.

## Part 1: Install the tools (one time, about 30 minutes)

1. **Install Android Studio** from <https://developer.android.com/studio>. Use the latest stable version and
   accept the default options. It bundles Java (the JDK) and the Android SDK, so you don't need anything else.
2. **Open it once** and let the "Setup Wizard" finish. It downloads the Android SDK (a few GB), so use Wi-Fi.
3. **Prepare your phone** (only needed to install straight from your PC):
   - Settings → About phone → tap **Build number** 7 times ("You are now a developer").
   - Settings → System → Developer options → turn on **USB debugging**.
   - Plug the phone into the PC with a USB cable and tap **Allow** on the "Allow USB debugging?" prompt.

## Part 2: Build the app

In a terminal, inside the project folder (`today-app`):

```bash
npm install
npm run android:build
```

That makes the web app and copies it into the `android/` folder. Then:

```bash
npm run android:open
```

Android Studio opens the project. **The first time, wait** (the progress bar at the bottom) while it syncs Gradle
and downloads a few things. If it asks to "Trust project" or to update the Gradle plugin, say **Trust** and
**Don't update** (the versions in the project are the ones tested together).

### Option A: Run it straight onto your phone
1. At the top, pick your phone in the device dropdown.
2. Press the green **▶ Run** button. The app installs and opens on your phone.

### Option B: Make an APK file to install yourself
1. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
2. When it finishes, click **locate** in the little pop-up. The file is at
   `android/app/build/outputs/apk/debug/app-debug.apk`.
3. Send it to your phone (USB, Google Drive, email to yourself). Tap it on the phone. If Android says
   "can't install from this source", tap **Settings** and allow it for that app (Files, Drive, Chrome…).

> Command-line alternative once Android Studio has been opened at least once: `npm run android:apk`.

## Part 3: First launch checklist

Open **Menu → 🙂 Me** and go through it (one minute). Then, in the **Notifications** part of that screen:

1. **Allow notifications** (Android 13 and up asks once).
2. **Exact reminders**: tap Allow so timed reminders arrive on time, not a few minutes late.
3. **Battery**: if it says Android may put the app to sleep, tap **Fix** and choose **Don't optimise /
   Unrestricted** for *Today by Sahil*. On Xiaomi, Oppo, Vivo, OnePlus and Samsung phones also allow
   *Autostart* / *Background activity* in the app's settings, or the phone may quietly kill reminders.
4. Tap **Send a test notification**, then lock your screen. You should see it in 5 seconds.

### Bringing your tasks over from the web version
In the web version: **Menu → Export JSON**. Send the file to your phone. In the app: **Menu → Import JSON**.
(After that the app keeps its own copy. The two don't sync.)

## Part 4: Updating the app after code changes

```bash
npm run android:build
```

Then press ▶ Run again (or rebuild the APK). Your tasks stay put when you reinstall over the top.
**Uninstalling the app deletes its data**, so export a backup first.

## What works where

| Thing | Web / PWA (Vercel) | Android app |
|---|---|---|
| Tasks, check-ins, Plan my day, "Me" | ✅ | ✅ |
| Voice input | Chrome only, needs internet | Native recogniser; works offline if the phone has the offline en-IN / hi-IN language pack |
| Notifications | ❌ | ✅ fully offline |
| Share to Today / icon shortcuts | PWA install only | ✅ native |
| Where data lives | the browser | the app's own storage |

**Offline voice:** on the phone, open Settings → Google → (or "Voice typing") → Offline speech recognition, and
download *English (India)* and *Hindi*.

## Things worth knowing

- **Notification buttons:** Android only shows 3 buttons, so you get **Done / On track / Snooze 2h**. Tapping the
  notification itself opens that task's check-in, which is where **Behind** (pick a new date) and **Stuck** live.
- **Buttons flash the app open:** the notification plugin launches the app when you press a button; Today applies
  the change and sends the app straight back to the background. A fully invisible button needs custom native code.
- **Work hours:** during your work shift only tasks in an area marked "Counts as work" can ping you. Everything
  else waits until work ends. Quiet hours hold back everything.

## If something goes wrong

- **"Gradle sync failed" / JDK problems:** File → Settings → Build Tools → Gradle → **Gradle JDK** → choose the
  *jbr-21* / *Embedded JDK* that came with Android Studio.
- **"SDK location not found":** File → Project Structure → SDK Location, and accept the suggested path.
- **Phone isn't listed:** unplug, re-plug, accept the USB debugging prompt; try another cable (some are charge-only).
- **No notifications:** Android Settings → Apps → Today by Sahil → Notifications → on; then Part 3, step 3.
- **Built the wrong thing / odd leftovers:** delete the `out` and `.next` folders, then `npm run android:build`.
