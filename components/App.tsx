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
import { dateInKey, resolveTap } from "@/lib/tap";
import { settleNote, settleOverflow } from "@/lib/settle";
import { actions, getData, useData } from "@/lib/store";
import { buildTimeline, firstThing, isNight } from "@/lib/timeline";
import type { ISODate, Task } from "@/lib/types";
import { AdjustSheet } from "./AdjustSheet";
import { AlarmRinger } from "./AlarmRinger";
import { CalendarSheet } from "./CalendarSheet";
import { startItem } from "./itemActions";
import { Capture, type CaptureCommand } from "./Capture";
import { CheckIn } from "./CheckIn";
import { EveningWrap } from "./EveningWrap";
import { IdeasSheet } from "./IdeasSheet";
import { ImportSheet } from "./ImportSheet";
import { BillsSheet, GoalsSheet, ShoppingSheet } from "./ListSheets";
import { CalendarIcon, MenuIcon } from "./icons";
import { MenuSheet } from "./MenuSheet";
import { NativeShell } from "./NativeShell";
import { QuoteCard, QuotesSheet } from "./QuoteCard";
import { FeelingSheet } from "./FeelingSheet";
import { NightHome } from "./NightHome";
import { ProfileSheet } from "./ProfileSheet";
import { PWA } from "./PWA";
import { SnoozeSheet } from "./SnoozeSheet";
import { TaskSheet } from "./TaskSheet";
import { TimerBar } from "./TimerBar";
import { TimerWatcher } from "./TimerWatcher";
import { TodayView, type OpenRequest } from "./TodayView";
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
  const [when, setWhen] = useState<{ id: string; mode: "snooze" | "schedule" } | null>(null);
  const [command, setCommand] = useState<CaptureCommand | undefined>();
  const [homeNote, setHomeNote] = useState<{ text: string; day: ISODate } | null>(null);
  const [peek, setPeek] = useState(false);
  const [calendarDay, setCalendarDay] = useState<ISODate | undefined>();
  const [quoteDate, setQuoteDate] = useState<ISODate>(() => todayISO());
  const [pendingTap, setPendingTap] = useState<TapTarget | null>(null);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [invite, setInvite] = useState<IcsEvent[] | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 5000 : 2600);
  }, []);

  const profile = useMemo(() => withDefaults(data?.profile), [data?.profile]);

  const ctx: ViewCtx = useMemo(
    () => ({ today, profile, open: setOpenId, notify, when: (id, mode) => setWhen({ id, mode }) }),
    [today, profile, notify],
  );

  // Tapping a notification takes you to the exact card. The tap is queued until the data has loaded (cold start).
  const onNotificationTap = useCallback((t: TapTarget) => setPendingTap(t), []);

  useEffect(() => {
    if (!pendingTap || !data) return;
    setPendingTap(null);
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
      const task = data.tasks.find((x) => x.id === r.taskId);
      if (task) setCheckIn([task]);
    } else if (r.k === "item" || r.k === "event" || (r.k === "panel" && r.panel === "progress")) {
      setPanel(null);
      setPeek(true);
      setRequest(r.k === "item" ? { id, k: "item", it: r.it, date: r.date } : r.k === "event" ? { id, k: "event", e: r.e } : { id, k: "progress" });
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
      setCommand({ kind: "prefill", text: parts.join(" ").trim(), nonce });
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
          setCommand({ kind: "prefill", text: dedup.join(" ").trim(), nonce });
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
  const tl = useMemo(() => (data ? buildTimeline(data, today, new Date(minuteKey * 60_000)) : null), [data, today, minuteKey]);

  // Tasks that don't fit this evening move to the next day with room, with a one-line note. (Overdue ones stay put.)
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => {
      const d = getData();
      const moves = settleOverflow(d, new Date());
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
    if (isQuoteDay(st, today, profile.quoteEvery) && st.assigned[today] === undefined && nowMin.getHours() * 60 + nowMin.getMinutes() >= toMin(profile.quoteTime)) actions.assignQuote(today);
  }, [data, today, minuteKey, profile.quoteEvery, profile.quoteTime]);

  if (!data || !tl) {
    return <div className="mx-auto min-h-dvh max-w-md" aria-busy="true" />;
  }

  const openTask = openId ? data.tasks.find((t) => t.id === openId) : undefined;
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
          />
        )}
      </main>

      {/* The input is always at the bottom: type or speak anything. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/92 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
          {hasTimer && <TimerBar data={data} ctx={ctx} />}
          <Capture ctx={ctx} data={data} command={command} />
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

      {openTask && <TaskSheet key={openTask.id} task={openTask} ctx={ctx} onClose={() => setOpenId(null)} timerOn={data.settings.timer?.taskId === openTask.id} />}
      {panel === "menu" && <MenuSheet onClose={closePanel} onPanel={(p) => (setCalendarDay(undefined), setPanel(p))} />}
      {panel === "calendar" && <CalendarSheet data={data} ctx={ctx} onClose={closePanel} initialDay={calendarDay} />}
      {panel === "shopping" && <ShoppingSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "bills" && <BillsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "goals" && <GoalsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "me" && <ProfileSheet profile={profile} bills={data.bills ?? []} learned={data.learned ?? []} data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "adjust" && <AdjustSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "ideas" && <IdeasSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "review" && <WeeklyReview data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "feeling" && <FeelingSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "quotes" && <QuotesSheet onClose={closePanel} />}
      {panel === "quote" && <QuoteCard date={quoteDate} onClose={closePanel} />}
      {panel === "evening" && <EveningWrap data={data} ctx={ctx} onClose={closePanel} />}
      {when && when.mode === "snooze" && data.tasks.some((t) => t.id === when.id) && <SnoozeSheet target={{ kind: "task", taskId: when.id }} ctx={ctx} onClose={() => setWhen(null)} />}
      {when && when.mode === "schedule" && data.tasks.find((t) => t.id === when.id) && (
        <WhenSheet task={data.tasks.find((t) => t.id === when.id)!} mode="schedule" ctx={ctx} onClose={() => setWhen(null)} />
      )}
      {invite && <ImportSheet events={invite} ctx={ctx} onClose={() => setInvite(null)} />}
      {checkIn && <CheckIn tasks={checkIn} today={today} onFinish={() => setCheckIn(null)} />}
    </div>
  );
}
