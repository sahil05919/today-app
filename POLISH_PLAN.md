# Today · polish plan (proposal)

Goal: the simplest daily app. One screen that says what's next, one input, one "Adjust my day" button.
All data, settings, sessions, bills, backups stay exactly as they are (new settings get defaults; nothing is migrated destructively).

## What I'm going to change

**The day becomes one computed timeline** (`lib/timeline.ts`, pure and tested).
Everything that has a time (events, phone-calendar events, timed tasks, commute, lunch, the tea break) is fixed.
Everything else (sessions, chores, bills, untimed tasks) is flexible and is placed into the best free gap.
Rules, all in one place: no overlaps ever, 10-minute buffers, a protected 17:00–18:00 tea/food break on weekdays,
evening load capped at 2.5 h (lighter on office days, with commute accounted for), overflow moves to the next day that has room.
Adding "fill form at 3pm" re-runs the timeline; whatever flexible item had to move gets a one-line note
("Moved Power BI to 18:30 to fit your form."). The weekly session planner keeps deciding *which days* sessions happen on;
it now uses the same constraints, so notifications and the screen agree.

**Home** = greeting with your name, a "Next up" card (Start / Done / Snooze), your top must-have as one line,
the timeline (carried-over items first, marked), and the input pinned at the bottom. Progress shrinks to one line
("This week 72% · On track"); the per-area dots move into the tap-through sheet. After 23:00 (editable) home shows only
"Time to sleep. Tomorrow starts with: …" and the input.

**Menu** = Calendar, Shopping list, Bills & chores, Must-haves, Settings. Backup and appearance move into Settings.
Rescue / Plan my tasks / Pick my 3 merge into **Adjust my day** (time + energy → rebuild today).
Wrap up is automatic: the evening notification says "Today: 5 of 6 done. Nice work, Sahil." and unfinished items simply carry over.
My patterns lives inside Weekly review (opened from the progress sheet and the Sunday card).
Getting bored + London events become **Free time ideas** (a link under the timeline).
"Later / someday" tasks live under Calendar → Someday.

**Pending work can't pile up**: overdue items are placed first and marked "carried over"; a task can be snoozed twice,
the third time you choose (do it now for 15 min / fixed slot / drop). 3+ overdue or behind on targets → the morning card says so plainly
and offers a one-tap catch-up plan. The Sunday review makes you decide on everything still pending.

**Calendar**: week + month views (tasks, sessions, events, bills); read-only phone-calendar sync (Android Calendar Provider,
my own small native plugin method, offline, asks permission once) shown as fixed blocks; "Open with Today" for `.ics` files;
shared text from any app lands in the input, prefilled.

**Understanding**: the offline dictionary grows to several hundred words/phrases (English + Hinglish + Devanagari) across all
categories with the verbs you listed; a generated 1000+ phrase test suite. Anything it doesn't recognise → after saving it asks
"Teach me this word?" and learns locally (Settings → What I've learned). Gemini still handles the rest.

**Also**: per-area "next session number" in Settings (Power BI starts at 14), "On track / Slightly behind" next to the %,
voice via native recording → Gemini transcription (editable transcript), falling back to Android's recogniser (en-IN, longer
silence tolerance, partial results), a Settings toggle to hide the mic, vibration + short encouraging lines when you tick things off.

## Stages
1. Menu cut, home timeline, Next up, realistic plans, night mode
2. Pending/pile-up rules, calendar views + phone-calendar sync, `.ics` and share import
3. Dictionary + tests, voice, session numbers, pace progress, feel-good touches

Each stage ends with: typecheck, tests, production build. A fresh APK is built at the end (`apk/`).

## What I can't verify from here
Anything that needs the phone itself: the Calendar permission prompt, real microphone/voice quality, vibration feel,
"Open with Today" from a mail client. Those are built to fail soft (hide the mic, skip calendar) and are listed in the final notes.
