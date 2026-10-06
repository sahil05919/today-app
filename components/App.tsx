"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkInCandidates } from "@/lib/checkin";
import { greeting, longDate, todayISO } from "@/lib/dates";
import { listenForLaunchIntents } from "@/lib/nativeBridge";
import type { TapTarget } from "@/lib/notifications/native";
import { withDefaults } from "@/lib/profile";
import { actions, getData, useData } from "@/lib/store";
import type { ISODate, Task } from "@/lib/types";
import { Capture, type CaptureCommand } from "./Capture";
import { CheckIn } from "./CheckIn";
import { EventsSheet } from "./EventsSheet";
import { EveningWrap } from "./EveningWrap";
import { MorningPlan } from "./MorningPlan";
import { PlanDay } from "./PlanDay";
import { PostponeSheet } from "./PostponeSheet";
import { ProfileSheet } from "./ProfileSheet";
import { TimerBar } from "./TimerBar";
import { Patterns, WeeklyReview } from "./WeeklyReview";
import { CalendarIcon, InboxIcon, LifebuoyIcon, MenuIcon, SunIcon } from "./icons";
import { LaterView } from "./LaterView";
import { MenuSheet } from "./MenuSheet";
import { NativeShell } from "./NativeShell";
import { PWA } from "./PWA";
import { Rescue } from "./Rescue";
import { TaskSheet } from "./TaskSheet";
import { TodayView } from "./TodayView";
import { WhenSheet } from "./WhenSheet";
import type { Panel, ViewCtx } from "./ui";
import { WeekView } from "./WeekView";

type Tab = "today" | "week" | "later";

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

export default function App() {
  const data = useData();
  const today = useToday();
  const [tab, setTab] = useState<Tab>("today");
  const [weekDay, setWeekDay] = useState<ISODate | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [checkIn, setCheckIn] = useState<Task[] | null>(null);
  /** A check-in opened from one notification: closing it shouldn't count as "today's check-in done". */
  const [checkInSingle, setCheckInSingle] = useState(false);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [when, setWhen] = useState<{ id: string; mode: "snooze" | "schedule" } | null>(null);
  const [command, setCommand] = useState<CaptureCommand | undefined>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoChecked = useRef(false);

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
    setTab("today");
    if (t.kind === "morning") setPanel("morning");
    else if (t.kind === "wrap") setPanel("evening");
    else if (task && task.status === "open") {
      if (t.kind === "checkin") {
        // "Behind" lives here: the check-in offers a new date or a small next step.
        setCheckInSingle(true);
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
      setTab("today");
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
        setTab("today");
        if (i.kind === "share") {
          const parts = [i.title, i.text].filter((v): v is string => !!v?.trim());
          const dedup = parts.filter((p, k) => !parts.some((o, j) => j !== k && o.includes(p) && (o.length > p.length || j < k)));
          setCommand({ kind: "prefill", text: dedup.join(" ").trim(), nonce });
        } else setCommand({ kind: i.kind, nonce });
      }),
    [],
  );

  // Daily check-in: once per day, on first open.
  useEffect(() => {
    if (!data || autoChecked.current) return;
    autoChecked.current = true;
    if (data.settings.lastCheckInDate === today) return;
    const list = checkInCandidates(data.tasks, today);
    if (list.length) {
      setCheckInSingle(false);
      setCheckIn(list);
    }
  }, [data, today]);

  const startCheckIn = () => {
    if (!data) return;
    const list = checkInCandidates(data.tasks, today);
    setPanel(null);
    if (list.length) {
      setCheckInSingle(false);
      setCheckIn(list);
    } else notify("Nothing needs checking in on right now. Lovely.");
  };

  const finishCheckIn = () => {
    if (!checkInSingle) actions.settings({ lastCheckInDate: today });
    setCheckIn(null);
  };

  if (!data) {
    return <div className="mx-auto min-h-dvh max-w-md" aria-busy="true" />;
  }

  // A task whose date has been pushed back 3+ times gets a gentle nudge (once everything else is closed).
  const postponed = data.tasks.find((t) => t.status === "open" && (t.snoozeCount ?? 0) >= 3);
  const openTask = openId ? data.tasks.find((t) => t.id === openId) : undefined;
  const selectedDay = weekDay && weekDay >= today ? weekDay : today;
  const title = tab === "today" ? greeting() : tab === "week" ? "This week" : "Later";
  const subtitle = tab === "today" ? longDate() : tab === "week" ? "The next seven days" : "No rush on these";

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "today", label: "Today", icon: <SunIcon /> },
    { id: "week", label: "This week", icon: <CalendarIcon /> },
    { id: "later", label: "Later", icon: <InboxIcon /> },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <PWA />
      <NativeShell data={data} onTap={onNotificationTap} />
      <header className="flex items-start justify-between px-5 pb-1 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        <div className="-mr-2 flex gap-1">
          <button onClick={() => setPanel("rescue")} aria-label="Rescue my day" className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-accent">
            <LifebuoyIcon />
          </button>
          <button onClick={() => setPanel("menu")} aria-label="Menu" className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface">
            <MenuIcon />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-52">
        {tab === "today" && (
          <TodayView
            data={data}
            ctx={ctx}
            onRescue={() => setPanel("rescue")}
            openPanel={setPanel}
            onPrefill={(text) => setCommand({ kind: "prefill", text, nonce: Date.now() })}
          />
        )}
        {tab === "week" && <WeekView data={data} ctx={ctx} selected={selectedDay} onSelect={setWeekDay} />}
        {tab === "later" && <LaterView data={data} ctx={ctx} />}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-30 flex justify-center px-4" role="status">
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

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pt-3">
          <TimerBar data={data} ctx={ctx} />
          <Capture ctx={ctx} defaultDate={tab === "week" ? selectedDay : undefined} command={command} />
          <nav className="mt-1 grid grid-cols-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]" aria-label="Views">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${tab === t.id ? "text-accent" : "text-muted"}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {openTask && (
        <TaskSheet key={openTask.id} task={openTask} ctx={ctx} onClose={() => setOpenId(null)} timerOn={data.settings.timer?.taskId === openTask.id} />
      )}
      {panel === "rescue" && <Rescue tasks={data.tasks} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "menu" && <MenuSheet data={data} ctx={ctx} onClose={() => setPanel(null)} onCheckIn={startCheckIn} onPanel={setPanel} />}
      {panel === "morning" && <MorningPlan tasks={data.tasks} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "evening" && <EveningWrap tasks={data.tasks} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "review" && <WeeklyReview tasks={data.tasks} ctx={ctx} onClose={() => setPanel(null)} onPatterns={() => setPanel("patterns")} />}
      {panel === "patterns" && <Patterns tasks={data.tasks} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "events" && <EventsSheet data={data} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "me" && <ProfileSheet profile={profile} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "plan" && <PlanDay data={data} ctx={ctx} onClose={() => setPanel(null)} />}
      {postponed && !openId && !when && !panel && !checkIn && (
        <PostponeSheet key={postponed.id} task={postponed} ctx={ctx} onClose={() => actions.update(postponed.id, { snoozeCount: 0 })} />
      )}
      {when && data.tasks.find((t) => t.id === when.id) && (
        <WhenSheet task={data.tasks.find((t) => t.id === when.id)!} mode={when.mode} ctx={ctx} onClose={() => setWhen(null)} />
      )}
      {checkIn && <CheckIn tasks={checkIn} today={today} onFinish={finishCheckIn} />}
    </div>
  );
}
