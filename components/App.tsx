"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkInCandidates } from "@/lib/checkin";
import { greeting, longDate, todayISO } from "@/lib/dates";
import { actions, useData } from "@/lib/store";
import type { ISODate, Task } from "@/lib/types";
import { Capture } from "./Capture";
import { CheckIn } from "./CheckIn";
import { CalendarIcon, InboxIcon, LifebuoyIcon, MenuIcon, SunIcon } from "./icons";
import { LaterView } from "./LaterView";
import { MenuSheet } from "./MenuSheet";
import { PWA } from "./PWA";
import { Rescue } from "./Rescue";
import { TaskSheet } from "./TaskSheet";
import { TodayView } from "./TodayView";
import type { ViewCtx } from "./ui";
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
  const [panel, setPanel] = useState<"menu" | "rescue" | null>(null);
  const [checkIn, setCheckIn] = useState<Task[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoChecked = useRef(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const ctx: ViewCtx = useMemo(() => ({ today, open: setOpenId, notify }), [today, notify]);

  // Daily check-in: once per day, on first open.
  useEffect(() => {
    if (!data || autoChecked.current) return;
    autoChecked.current = true;
    if (data.settings.lastCheckInDate === today) return;
    const list = checkInCandidates(data.tasks, today);
    if (list.length) setCheckIn(list);
  }, [data, today]);

  const startCheckIn = () => {
    if (!data) return;
    const list = checkInCandidates(data.tasks, today);
    setPanel(null);
    if (list.length) setCheckIn(list);
    else notify("Nothing needs checking in on right now. Lovely.");
  };

  const finishCheckIn = () => {
    actions.settings({ lastCheckInDate: today });
    setCheckIn(null);
  };

  if (!data) {
    return <div className="mx-auto min-h-dvh max-w-md" aria-busy="true" />;
  }

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
      <header className="flex items-start justify-between px-5 pb-1 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        <div className="-mr-2 flex gap-1">
          <button onClick={() => setPanel("rescue")} aria-label="Rescue my day" className="rounded-full p-2.5 text-muted hover:bg-surface hover:text-accent">
            <LifebuoyIcon />
          </button>
          <button onClick={() => setPanel("menu")} aria-label="Menu" className="rounded-full p-2.5 text-muted hover:bg-surface">
            <MenuIcon />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-52">
        {tab === "today" && <TodayView data={data} ctx={ctx} onRescue={() => setPanel("rescue")} />}
        {tab === "week" && <WeekView data={data} ctx={ctx} selected={selectedDay} onSelect={setWeekDay} />}
        {tab === "later" && <LaterView data={data} ctx={ctx} />}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-30 flex justify-center px-4" role="status">
          <div className="anim-fade rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-lg">{toast}</div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pt-3">
          <Capture ctx={ctx} defaultDate={tab === "week" ? selectedDay : undefined} />
          <nav className="mt-1 grid grid-cols-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]" aria-label="Views">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${tab === t.id ? "text-accent" : "text-muted"}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {openTask && <TaskSheet key={openTask.id} task={openTask} ctx={ctx} onClose={() => setOpenId(null)} />}
      {panel === "rescue" && <Rescue tasks={data.tasks} ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === "menu" && <MenuSheet data={data} ctx={ctx} onClose={() => setPanel(null)} onCheckIn={startCheckIn} />}
      {checkIn && <CheckIn tasks={checkIn} today={today} onFinish={finishCheckIn} />}
    </div>
  );
}
