"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eveningLine, greetingFor } from "@/lib/cheer";
import { longDate, todayISO } from "@/lib/dates";
import { listenForLaunchIntents } from "@/lib/nativeBridge";
import type { TapTarget } from "@/lib/notifications/native";
import { withDefaults } from "@/lib/profile";
import { settleNote, settleOverflow } from "@/lib/settle";
import { actions, getData, useData } from "@/lib/store";
import { buildTimeline, firstThing, isNight } from "@/lib/timeline";
import type { ISODate, Task } from "@/lib/types";
import { AdjustSheet } from "./AdjustSheet";
import { AlarmRinger } from "./AlarmRinger";
import { CalendarSheet } from "./CalendarSheet";
import { Capture, type CaptureCommand } from "./Capture";
import { CheckIn } from "./CheckIn";
import { EveningWrap } from "./EveningWrap";
import { IdeasSheet } from "./IdeasSheet";
import { BillsSheet, GoalsSheet, ShoppingSheet } from "./ListSheets";
import { MenuIcon } from "./icons";
import { MenuSheet } from "./MenuSheet";
import { NativeShell } from "./NativeShell";
import { NightHome } from "./NightHome";
import { ProfileSheet } from "./ProfileSheet";
import { PWA } from "./PWA";
import { SnoozeSheet } from "./SnoozeSheet";
import { TaskSheet } from "./TaskSheet";
import { TimerBar } from "./TimerBar";
import { TodayView } from "./TodayView";
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

  // Tapping a notification takes you to the right place.
  const onNotificationTap = useCallback((t: TapTarget) => {
    const task = t.taskId ? getData().tasks.find((x) => x.id === t.taskId) : undefined;
    if (t.kind === "wrap") setPanel("evening");
    else if (t.kind === "review") setPanel("review");
    else if (t.kind === "morning") setPanel(null);
    else if (task && task.status === "open") {
      if (t.kind === "checkin") {
        // "Behind" lives here: the check-in offers a new date or a small next step.
        setCheckIn([task]);
      } else setOpenId(task.id);
    }
  }, []);

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
      <header className="flex items-start justify-between px-5 pb-2 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{greetingFor(profile.name, now)}</h1>
          <p className="text-sm text-muted">{evening && !night ? eveningLine(profile.name, tl.summary.done, tl.summary.total) : longDate(now)}</p>
        </div>
        <button onClick={() => setPanel("menu")} aria-label="Menu" className="-mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface">
          <MenuIcon width={24} height={24} />
        </button>
      </header>

      <main className="flex-1 px-4 pb-40">
        {night && first ? (
          <NightHome first={first.item} isTomorrow={first.isTomorrow} onPeek={() => setPeek(true)} />
        ) : (
          <TodayView data={data} ctx={ctx} tl={tl} now={now} homeNote={note} openPanel={setPanel} onPrefill={(text) => setCommand({ kind: "prefill", text, nonce: Date.now() })} />
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
      {panel === "menu" && <MenuSheet onClose={closePanel} onPanel={setPanel} />}
      {panel === "calendar" && <CalendarSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "shopping" && <ShoppingSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "bills" && <BillsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "goals" && <GoalsSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "me" && <ProfileSheet profile={profile} bills={data.bills ?? []} learned={data.learned ?? []} data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "adjust" && <AdjustSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "ideas" && <IdeasSheet data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "review" && <WeeklyReview data={data} ctx={ctx} onClose={closePanel} />}
      {panel === "evening" && <EveningWrap data={data} ctx={ctx} onClose={closePanel} />}
      {when && when.mode === "snooze" && data.tasks.some((t) => t.id === when.id) && <SnoozeSheet target={{ kind: "task", taskId: when.id }} ctx={ctx} onClose={() => setWhen(null)} />}
      {when && when.mode === "schedule" && data.tasks.find((t) => t.id === when.id) && (
        <WhenSheet task={data.tasks.find((t) => t.id === when.id)!} mode="schedule" ctx={ctx} onClose={() => setWhen(null)} />
      )}
      {checkIn && <CheckIn tasks={checkIn} today={today} onFinish={() => setCheckIn(null)} />}
    </div>
  );
}
