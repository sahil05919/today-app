"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eveningLine, greetingFor } from "@/lib/cheer";
import { longDate, todayISO } from "@/lib/dates";
import { parseICS, type IcsEvent } from "@/lib/calendar";
import { listenForLaunchIntents } from "@/lib/nativeBridge";
import type { TapTarget } from "@/lib/notifications/native";
import { pendingSlotShifts } from "@/lib/capacity";
import { ensureLetter } from "@/lib/coachRun";
import { toMin, withDefaults } from "@/lib/profile";
import { isQuoteDay, quoteStateOf } from "@/lib/quoteBag";
import { quoteMinute } from "@/lib/brief";
import { aiEnabled } from "@/lib/ai";
import { looksLikeBooking, parseShared, type ParsedShare } from "@/lib/shareParse";
import { readWithGemini } from "@/lib/shareAi";
import { dateInKey, resolveTap } from "@/lib/tap";
import { markOpen, timed } from "@/lib/devTiming";
import { addedLine } from "@/lib/inbox";
import { runCategoryLookups } from "@/lib/catAi";
import { closeAllSheets } from "@/lib/sheetStack";
import { settleNote, settleOverflow } from "@/lib/settle";
import { findTask, seriesOf } from "@/lib/series";
import { weekStart } from "@/lib/stats";
import { checkDue } from "@/lib/selfcheck";
import { runCheck } from "@/lib/selfcheckRun";
import { dayDoneState } from "@/lib/lighten";
import { notifyDayDone } from "@/lib/notifications/native";
import { actions, getData, useData } from "@/lib/store";
import { buildTimeline, firstThing, isNight } from "@/lib/timeline";
import type { ISODate, SessionLog, Task } from "@/lib/types";
import { AdjustSheet } from "./AdjustSheet";
import { AlarmRinger } from "./AlarmRinger";
import { CalendarSheet } from "./CalendarSheet";
import { CategoryPickerHost } from "./CategoryChip";
import { startItem } from "./itemActions";
import { Capture, type CaptureCommand } from "./Capture";
import { CheckIn } from "./CheckIn";
import { EveningWrap } from "./EveningWrap";
import { IdeasSheet } from "./IdeasSheet";
import { BackupsSheet } from "./BackupSettings";
import { LearningLogSheet, LearningPrompt } from "./Learning";
import { learnPromptFor } from "@/lib/learning";
import { LightenSheet } from "./LightenSheet";
import { WinJarSheet } from "./WinJar";
import { SearchSheet } from "./SearchSheet";
import { ShareEventSheet } from "./ShareEventSheet";
import { SideWorkSheet } from "./SideWorkSheet";
import { ImportSheet } from "./ImportSheet";
import { BillsSheet, GoalsSheet, ShoppingSheet } from "./ListSheets";
import { CalendarIcon, MenuIcon, SearchIcon } from "./icons";
import { MenuSheet } from "./MenuSheet";
import { NativeShell } from "./NativeShell";
import { QuoteCard, QuotesSheet } from "./QuoteCard";
import { FeelingSheet } from "./FeelingSheet";
import { NightHome } from "./NightHome";
import { ProfileSheet } from "./ProfileSheet";
import { PWA } from "./PWA";
import { RescheduleSheet } from "./RescheduleSheet";
import { TaskSheet } from "./TaskSheet";
import { TimerBar } from "./TimerBar";
import { TimerWatcher } from "./TimerWatcher";
import { TodayView, type OpenRequest } from "./TodayView";
import { ReviewsSheet, WeekSoFarSheet } from "./ReviewsSheet";
import { WeeklyReview } from "./WeeklyReview";
import { WhenSheet } from "./WhenSheet";
import { type Panel, type ViewCtx } from "./ui";

/** Re-renders when the date rolls over (e.g. app left open overnight). */
function useToday(): ISODate {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const refresh = () => setToday(todayISO());
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return today;
}

/** The current time, refreshed every half minute (and whenever the app comes back to the front). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}

export default function App() {
  const data = useData();
  const today = useToday();
  const now = useNow();
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [checkIn, setCheckIn] = useState<Task[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [when, setWhen] = useState<{ id: string; mode: "reschedule" | "schedule" } | null>(null);
  const [command, setCommand] = useState<CaptureCommand | undefined>();
  const [homeNote, setHomeNote] = useState<{ text: string; day: ISODate } | null>(null);
  const [peek, setPeek] = useState(false);
  const [calendarDay, setCalendarDay] = useState<ISODate | undefined>();
  const [quoteDate, setQuoteDate] = useState<ISODate>(() => todayISO());
  const [pendingTap, setPendingTap] = useState<TapTarget | null>(null);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [shareHint, setShareHint] = useState(false);
  const [share, setShare] = useState<ParsedShare | null>(null);
  const [invite, setInvite] = useState<IcsEvent[] | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // "What did you learn?": right after a session of a chosen area is done (not on load, not for backfilled days). A prompt, not a notification.
  const [learnFor, setLearnFor] = useState<SessionLog | null>(null);
  const seenSessions = useRef<{ list: SessionLog[] } | null>(null);

  const notify = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 5000 : 2600);
  }, []);

  const profile = useMemo(() => withDefaults(data?.profile), [data?.profile]);

  // Text shared from Gmail (or anywhere): read on the phone first. Gemini is asked ONLY if the phone found no date and a key is set,
  // and then the confirm sheet says so. A short note or a link is simply captured as before. Nothing is saved without the sheet.
  const onShared = useCallback(
    (text: string) => {
      const prefill = () => setCommand({ kind: "prefill", text: text.replace(/\s+/g, " ").trim(), nonce: Date.now() });
      const local = parseShared(text, new Date());
      if (local) return setShare(local);
      if (aiEnabled() && looksLikeBooking(text)) {
        notify("Reading it with Gemini…");
        void readWithGemini(text, new Date()).then((g) => (g ? setShare(g) : prefill()));
        return;
      }
      prefill();
    },
    [notify],
  );
  const onSharedRef = useRef(onShared);
  onSharedRef.current = onShared;

  const ctx: ViewCtx = useMemo(
    () => ({ today, profile, open: setOpenId, notify, when: (id, mode) => setWhen({ id, mode }) }),
    [today, profile, notify],
  );

  // Tapping a notification takes you to the exact card. The tap is queued until the data has loaded (cold start).
  const onNotificationTap = useCallback((t: TapTarget) => setPendingTap(t), []);

  useEffect(() => {
    if (!pendingTap || !data) return;
    setPendingTap(null);
    // Everything that is open closes first (top sheet first), so the target opens on a clean screen and no backdrop is left over.
    closeAllSheets();
    const r = resolveTap(data, pendingTap, todayISO(), new Date());
    const id = Date.now();
    if (pendingTap.start) {
      // The widget's Start button: open straight into the item with its timer running.
      if (r.k === "item") startItem(r.it, ctx);
      else if (r.k === "task") {
        actions.startTimer(r.taskId);
        notify("Timer running. Go for it.");
      } else if (r.k === "gone") notify(r.message);
      return;
    }
    if (r.k === "task") setOpenId(r.taskId);
    else if (r.k === "checkin") {
      // "Behind" lives here: the check-in offers a new date or a small next step.
      const task = findTask(data, r.taskId);
      if (task) setCheckIn([task]);
    } else if (r.k === "item" || r.k === "event" || (r.k === "panel" && r.panel === "progress")) {
      setPanel(null);
      setPeek(true);
      setRequest(r.k === "item" ? { id, k: "item", it: r.it, date: r.date } : r.k === "event" ? { id, k: "event", e: r.e } : { id, k: "progress" });
    } else if (r.k === "panel" && r.panel === "tonight") {
      // The 20:00 check-in: land on Today with the share hint.
      setPanel(null);
      setShareHint(true);
    } else if (r.k === "panel") {
      if (r.panel === "quote") setQuoteDate(dateInKey(pendingTap.key) ?? todayISO());
      setPanel(r.panel as Panel);
    }
    else if (r.k === "gone") notify(r.message);
  }, [pendingTap, data, notify, ctx]);

  // Opened from Android "Share to Today" or an app shortcut: /?text=…  /?new=1  /?voice=1
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const shared = [q.get("title"), q.get("text"), q.get("url")].filter((v): v is string => !!v?.trim());
    const nonce = Date.now();
    if (shared.length) {
      // Many apps repeat the link in both text and url; keep each distinct piece once.
      const parts = shared.filter((p, i) => !shared.some((o, j) => j !== i && o.includes(p) && (o.length > p.length || j < i)));
      onSharedRef.current(parts.join("\n").trim());
    } else if (q.get("voice")) setCommand({ kind: "voice", nonce });
    else if (q.get("new")) setCommand({ kind: "new", nonce });
    else return;
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // Android: "Share to Today" and the New task / Voice task app-icon shortcuts arrive as native intents.
  useEffect(
    () =>
      listenForLaunchIntents((i) => {
        const nonce = Date.now();
        if (i.kind === "share") {
          const parts = [i.title, i.text].filter((v): v is string => !!v?.trim());
          const dedup = parts.filter((p, k) => !parts.some((o, j) => j !== k && o.includes(p) && (o.length > p.length || j < k)));
          onSharedRef.current(dedup.join("\n").trim());
        } else if (i.kind === "ics") {
          // "Open with Today" on a calendar invite: show what's in it before adding.
          setInvite(parseICS(i.text ?? ""));
        } else if (i.kind === "start") {
          // Widget → Start on an item: route it like a notification tap, then start its timer.
          const kind = i.itemKind === "session" || i.itemKind === "chore" || i.itemKind === "bill" ? i.itemKind : "slot";
          setPendingTap({ kind, key: i.key, ref: i.ref, taskId: i.taskId, start: true });
        } else if (i.kind === "new" || i.kind === "voice") setCommand({ kind: i.kind, nonce });
      }),
    [],
  );

  // The day, as one timeline.
  const minuteKey = Math.floor(now.getTime() / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tl = useMemo(() => (data ? timed("planner: buildTimeline(today)", () => buildTimeline(data, today, new Date(minuteKey * 60_000))) : null), [data, today, minuteKey]);

  const sessionsNow = data?.sessions;
  useEffect(() => {
    if (!data) return;
    const before = seenSessions.current;
    seenSessions.current = { list: data.sessions ?? [] };
    if (!before) return; // the first look at the data: nothing in it is new
    const l = learnPromptFor(before.list, data.sessions, data, new Date());
    if (l) setLearnFor(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsNow]);

  // Titles the phone could not place are asked about in the background (Gemini, online only, 20 at most per app open; lib/catAi.ts).
  const loadedForCategories = !!data;
  useEffect(() => {
    if (!loadedForCategories) return;
    const id = setTimeout(() => void runCategoryLookups(), 6000);
    return () => clearTimeout(id);
  }, [loadedForCategories]);

  // Tasks the Gmail add-on sent (lib/inboxRun.ts): say so once, then forget it.
  const addedFromGmail = data?.settings.inboxAdded;
  useEffect(() => {
    if (!addedFromGmail) return;
    notify(addedLine(addedFromGmail.n));
    actions.bookkeeping({ inboxAdded: undefined });
  }, [addedFromGmail, notify]);

  // The first render that has data is "Today is usable": the dev timing log notes how long the page took to get here.
  useEffect(() => {
    if (tl) markOpen();
  }, [tl]);

  // Tasks that don't fit this evening move to the next day with room, with a one-line note. (Overdue ones stay put.)
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => {
      const d = getData();
      const moves = timed("planner: settleOverflow", () => settleOverflow(d, new Date()));
      if (!moves.length) return;
      actions.moveTasks(moves.map((m) => ({ taskId: m.taskId, to: m.to })));
      const text = settleNote(moves);
      if (text) setHomeNote({ text, day: todayISO() });
    }, 700);
    return () => clearTimeout(id);
  }, [data]);

  // Sunday: the week's letter is written the first time the app opens (rules, or Gemini with a key).
  const sunday = new Date(minuteKey * 60_000).getDay() === 0;
  const loaded = !!data;
  useEffect(() => {
    if (loaded && sunday) void ensureLetter();
  }, [loaded, sunday, today]);

  // The weekly snapshots (finished weeks, Friday's "Week so far", Sunday's "Your week") are saved as they come due.
  const quarter = Math.floor(minuteKey / 15);
  useEffect(() => {
    if (loaded) actions.saveWeeks();
  }, [loaded, today, quarter]);

  // Opening the app counts as the morning brief: note it, and today's 09:30 notification is cancelled by the next reschedule.
  useEffect(() => {
    if (!loaded) return;
    const mark = () => {
      const d = getData();
      const t = todayISO();
      if (d.settings.openedDate !== t && document.visibilityState === "visible") actions.settings({ openedDate: t });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [loaded, today]);

  // The morning self-check: on the first open each day, and on coming back if the last one is over 12 hours old.
  useEffect(() => {
    if (!loaded) return;
    const go = () => {
      if (checkDue(getData(), new Date())) void runCheck();
    };
    const id = setTimeout(go, 2500);
    const onVisible = () => document.visibilityState === "visible" && go();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loaded, today]);

  // The day's list is finished and there is evening left: the card shows by itself, and ONE notification goes out a day.
  useEffect(() => {
    if (!data || !tl) return;
    const st = dayDoneState(data, new Date(minuteKey * 60_000), tl);
    if (!st.offer || data.settings.dayDoneDate === today) return;
    actions.settings({ dayDoneDate: today });
    if (withDefaults(data.profile).notify.dayDone !== false) void notifyDayDone();
  }, [data, tl, today, minuteKey]);

  // Each new day (and on start): older unresolved repeats are logged as missed; only the latest carries forward.
  useEffect(() => {
    if (loaded) actions.sweep();
  }, [loaded, today]);

  // The planner moved a session to the slot where it really happens: say so once, never silently.
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => {
      const d = getData();
      const shift = pendingSlotShifts(d, todayISO())[0];
      if (!shift) return;
      actions.settings({ slotShifts: { ...(d.settings.slotShifts ?? {}), [shift.areaId]: shift.slotId } });
      setHomeNote({ text: shift.text, day: todayISO() });
    }, 1500);
    return () => clearTimeout(id);
  }, [data]);

  // A day's quote is pinned to its place in the bag once its time has come (even if the notification was never opened).
  useEffect(() => {
    if (!data || !profile.quoteEvery) return;
    if (minuteKey * 60_000 < 0) return;
    const nowMin = new Date(minuteKey * 60_000);
    const st = quoteStateOf(data);
    if (isQuoteDay(st, today, profile.quoteEvery) && st.assigned[today] === undefined && nowMin.getHours() * 60 + nowMin.getMinutes() >= quoteMinute(data, today, profile.quoteFrom, profile.quoteTo)) actions.assignQuote(today);
  }, [data, today, minuteKey, profile.quoteEvery, profile.quoteFrom, profile.quoteTo]);

  if (!data || !tl) {
    return <div className="mx-auto min-h-dvh max-w-md" aria-busy="true" />;
  }

  const openTask = openId ? findTask(data, openId) : undefined;
  const night = isNight(now, profile) && !peek;
  const first = night ? firstThing(data, now) : null;
  const evening = now.getHours() >= 18 && tl.summary.total > 0;
  const closePanel = () => setPanel(null);
  const note = homeNote && homeNote.day === today ? homeNote.text : null;
  const hasTimer = !!data.settings.timer;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <PWA />
      <NativeShell data={data} onTap={onNotificationTap} />
      <AlarmRinger data={data} />
      <TimerWatcher data={data} ctx={ctx} />
      <header className="flex items-start justify-between px-5 pb-2 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{greetingFor(profile.name, now)}</h1>
          <p className="text-sm text-muted">{evening && !night ? eveningLine(profile.name, tl.summary.done, tl.summary.total) : longDate(now)}</p>
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          <button onClick={() => setPanel("search")} aria-label="Search" className="flex h-12 w-12 items-center justify-center rounded-full text-muted hover:bg-surface">
            <SearchIcon width={24} height={24} />
          </button>
          <button
            onClick={() => {
              setCalendarDay(undefined);
              setPanel("calendar");
            }}
            aria-label="Calendar"
            className="flex h-12 w-12 items-center justify-center rounded-full text-muted hover:bg-surface"
          >
            <CalendarIcon width={24} height={24} />
          </button>
          <button onClick={() => setPanel("menu")} aria-label="Menu" className="flex h-12 w-12 items-center justify-center rounded-full text-muted hover:bg-surface">
            <MenuIcon width={24} height={24} />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-40">
        {night && first ? (
          <NightHome first={first.item} isTomorrow={first.isTomorrow} onPeek={() => setPeek(true)} />
        ) : (
          <TodayView data={data} ctx={ctx} tl={tl} now={now} homeNote={note} openPanel={setPanel} onPrefill={(text) => setCommand({ kind: "prefill", text, nonce: Date.now() })}
            onCalendar={(day) => {
              setCalendarDay(day);
              setPanel("calendar");
            }}
            request={request}
            shareHint={shareHint}
            onHintDone={() => setShareHint(false)}
          />
        )}
      </main>

      {/* The input is always at the bottom: type or speak anything. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/92 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
          {hasTimer && <TimerBar data={data} ctx={ctx} />}
          <Capture ctx={ctx} data={data} command={command} onLighten={() => setPanel("lighten")} />
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4" role="status">
          <div className="anim-fade pointer-events-auto flex items-center gap-3 rounded-full bg-ink py-2 pl-4 pr-2 text-sm text-bg shadow-lg">
            <span>{toast.msg}</span>
            {toast.undo && (
              <button
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
                className="min-h-9 rounded-full px-3 font-semibold text-accent"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}

      {openTask && seriesOf(data, openTask.id)?.lifeId === "side-work" && <SideWorkSheet key={openTask.id} data={data} ctx={ctx} taskId={openTask.id} onClose={() => setOpenId(null)} />}
      {openTask && seriesOf(data, openTask.id)?.lifeId !== "side-work" && <TaskSheet key={openTask.id} task={openTask} ctx={ctx} onClose={() => setOpenId(null)} timerOn={data.settings.timer?.taskId === openTask.id} />}
      {panel === "menu" && <MenuSheet onClose={closePanel} onPanel={(p) => (setCalendarDay(undefined), setPanel(p))} />}
      {panel === "calendar" && <CalendarSheet data={data} ctx={ctx} onClose={closePanel} initialDay={calendarDay} />}
      {panel === "shopping" && <ShoppingSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "bills" && <BillsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "goals" && <GoalsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "me" && <ProfileSheet profile={profile} bills={data.bills ?? []} learned={data.learned ?? []} data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "adjust" && <AdjustSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "ideas" && <IdeasSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "review" && <WeeklyReview data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "sofar" && <WeekSoFarSheet data={data} ctx={ctx} onClose={closePanel} onDone={() => actions.settings({ sofarWeek: weekStart(today) })} />}
      {panel === "reviews" && <ReviewsSheet data={data} ctx={ctx} onClose={closePanel} openPanel={setPanel} />}
      {panel === "feeling" && <FeelingSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "quotes" && <QuotesSheet onClose={closePanel} />}
      {panel === "search" && <SearchSheet data={data} ctx={ctx} onClose={closePanel} openPanel={setPanel} />}
      {panel === "winjar" && <WinJarSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "learning" && <LearningLogSheet data={data} ctx={ctx} onClose={closePanel} />}
      {learnFor && <LearningPrompt log={learnFor} data={data} ctx={ctx} onClose={() => setLearnFor(null)} />}
      {panel === "quote" && <QuoteCard date={quoteDate} onClose={closePanel} />}
      {panel === "evening" && <EveningWrap data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "backups" && <BackupsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "lighten" && <LightenSheet data={data} ctx={ctx} now={new Date()} onClose={closePanel} />}
      {when && when.mode === "reschedule" && !!findTask(data, when.id) && <RescheduleSheet target={{ kind: "task", taskId: when.id }} ctx={ctx} onClose={() => setWhen(null)} />}
      {when && when.mode === "schedule" && findTask(data, when.id) && <WhenSheet task={findTask(data, when.id)!} mode="schedule" ctx={ctx} onClose={() => setWhen(null)} />}
      {share && <ShareEventSheet key={share.date + share.title} share={share} data={data} ctx={ctx} onClose={() => setShare(null)} />}
      {invite && <ImportSheet events={invite} ctx={ctx} onClose={() => setInvite(null)} />}
      {checkIn && <CheckIn tasks={checkIn} today={today} onFinish={() => setCheckIn(null)} />}
      <CategoryPickerHost notify={notify} />
    </div>
  );
}
