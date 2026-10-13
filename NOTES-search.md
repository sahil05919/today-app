# Search + categories + "what the app did" + Gmail inbox fix (data version 5)

## Where things are

- **Categories**: `lib/categorise.ts` (`categorise(item, ctx)`, the one decision; `catCtx(data)` builds the context once per data snapshot), `lib/catDict.ts` (curated English + Hinglish groups, weights, plurals; the older lists in `lib/dictionary.ts` fill in behind them), `lib/learn.ts` (learned rules: `learnFix` with a `sub`, `matchLearnedArea`), `lib/catAi.ts` (Gemini last resort: only titles, online only, cached in `data.catCache`, 20 per app open), `lib/catHistory.ts` (history entries carry `cat`; the v5 backfill), `lib/entries.ts` (the item index), `lib/catUi.ts` + `lib/catPicker.ts` + `components/CategoryChip.tsx` (chip, one picker sheet for the whole app, mounted in `App.tsx`). Stored: `data.catPicks` (hand-picked, by item key), `data.catCache`, `LearnedRule.sub`, `Task.catHow`, `HistoryEvent.cat`.
- **Search**: `lib/query.ts` (`parseQuery`: area / time / intent / words), `lib/search.ts` (`search(data, text, now)`: answer card + Upcoming / Done / Missed groups + auto list), `components/SearchSheet.tsx`. Index = `buildEntries(data, today)`, memoized per data snapshot (`lib/memo.ts`).
- **What the app did**: `lib/autoLog.ts` (pure: `appendAuto`, `dueChanges`, `movesBetween`, `carriedBetween`, `newCalendarEntries`, `lifeAdminToday`, `digestEntry`, `autoRows`, `chipCount`, `checkinLine`), store actions `logAuto`, `scanLifeAdmin`, `seeAuto`, `seeAllAuto`, `removeAuto`, `undoAutoMoves`; `components/AppDid.tsx` (chip + sheet). Sources are set at creation: `Task.src`, `FixedEvent.src` (or derived: `taskSource` / `eventSource` in `entries.ts`), life admin from `Series.lifeId`.
- **Gmail inbox**: `lib/inboxRun.ts` (`importInbox` returns and saves an `InboxCheck`; `checkInboxNow`), `lib/inbox.ts` (`inboxStatusLines`, `digestKey`, `digestCard`), `components/CalendarSettings.tsx`, `TodayNativePlugin.java` `listCalendars`.

## Judgement calls

- **Categories are computed on read**, not written onto every task. Only what you chose (`catPicks`, a task's `area`), what Gemini said (`catCache`) and history entries (`cat`, because the item may be gone and the raw history is archived after 8 weeks) are stored. This keeps one source of truth, so a learned rule or a deleted rule changes every item at once and nothing goes stale. The v5 migration therefore backfills only history.
- **An area stored on a task counts as chosen** (high confidence) unless the capture recorded that it was a guess (`catHow`). Old tasks have no `catHow`, so they are treated as chosen.
- **"Life", "Side work" and "Other"** are the existing areas `life`, `sidework`, `others`. Building / Admin / Learning are the sub-labels of Other (area `others`); chores words go to the Life area. If you keep your own Admin or Learning area, items you filed there keep it.
- **Curated words beat the older word lists** (a head start of 3 points), so "report" is Power BI as asked, but a stored area, a learned rule or a #tag beats both. "padhai" alone is English Reading; with "exam" or "course" it is Learning.
- **A learned rule keeps the words the dictionary knows** ("evening gym with Sam" teaches `gym`), so it catches more; if none are known it keeps all the title's key words.
- **Other in search** is everything that is not a tracked area, exactly as the weekly review counts it (`otherEntriesBetween`), so its numbers match the review; an item categorised Health (an area with no weekly target) is therefore also in "Other this week".
- **A bare area word** ("rent", "gym") shows that area's card for this week (as asked: area detected → card). Add a month or a word that is not a category word to search all history.
- **Search numbers**: tracked areas use `weekStats` (week), `jarBetween` (counts for any range), `bestStreaks`, and the planner's `planWeek` for "next". Month counts do not include events that stand in for a session (the weekly review does), because the win jar does not either.
- **Gmail TASK: events are always `gmail-task`** unless the script adds a `kind:` note line (star, shift, interview, bill, booking). The title is never guessed at.
- **The feed counts rows, not moves**: a re-plan of 5 items is one row and counts once in the chip. Planner moves are the app's own (the evening overflow, a clear command, a carried session, a pull). Moves you choose yourself (Reschedule, Adjust my day, the weekly review) are not listed. The first read of the phone calendar only learns what is there.
- **Life admin** is listed once, the first time the app is opened on its day.
- **Remove** on a phone-calendar event hides it in Today only (Today never changes your calendar); on the digest it dismisses that digest.
- **The digest card** is dismissed per digest (its day plus a hash of its content); old saves that stored just a day still hide that whole day.

## The Gmail import bug

Cause (found from the code; not reproduced on a phone): `listCalendars` in `TodayNativePlugin.java` required the READ+WRITE permission alias, while the import only checked READ. With read-only access the call was rejected, Today saw no calendars, and `importInbox` returned "no-calendar" without telling anyone. (The Settings screen also listed calendars only when write access was granted.) Fixed: listing needs only READ (and flags `writable` / `visible` / `sync` per calendar); the import uses the picked calendar, then the name (dash / case / spacing do not matter), then the stored id if listing fails, and as a last resort searches every calendar for `TASK:` / `DIGEST:` events (importing but not deleting). The last check is saved and shown in Settings → Calendar → Gmail inbox. All-day dates (UTC midnight), the read window (30 days back, 120 ahead from local midnight), and open + resume triggers were checked and are covered by `tests/inbox-import.test.ts` (including 00:30 BST).

## Not verified on a device

Search, chips, the feed and the picker were exercised in the browser preview and in tests. On Android nothing was run: the permission fix, the calendar search fallback, Gmail import, and the background Gemini lookups. See the phone checklist in the report.
