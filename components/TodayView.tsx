"use client";
import { useState } from "react";
import { backupDue, exportBackup } from "@/lib/backup";
import { diffDays, toISO } from "@/lib/dates";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { balanceNudge } from "@/lib/balance";
import { computeNudges, nudgeKey } from "@/lib/nudges";
import { isNative } from "@/lib/platform";
import { weekStart } from "@/lib/stats";
import { EventsStrip } from "./EventsSheet";
import { TaskCard } from "./TaskCard";
import { ProgressSheet, TodayPlan } from "./TodayPlan";
import { CheckIcon } from "./icons";
import { btn, Empty, SectionTitle, sortTasks, type Panel, type ViewCtx } from "./ui";

function Nudge({ emoji, title, body, action, onAction }: { emoji: string; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <button onClick={onAction} className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-accent-soft p-3.5 text-left">
      <span className="text-2xl" aria-hidden="true">
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
      <span className="shrink-0 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink">{action}</span>
    </button>
  );
}

export function TodayView({
  data,
  ctx,
  onRescue,
  openPanel,
  onPrefill,
}: {
  data: AppData;
  ctx: ViewCtx;
  onRescue: () => void;
  openPanel: (p: Panel) => void;
  onPrefill: (text: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const [progress, setProgress] = useState(false);
  const open = data.tasks.filter((t) => t.status === "open");
  const focus = sortTasks(open.filter((t) => t.focus));
  const dueNow = sortTasks(open.filter((t) => !t.focus && t.due != null && diffDays(t.due, ctx.today) <= 0));
  const doneToday = data.tasks
    .filter((t) => t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) === ctx.today)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const showBackup = backupDue(data);
  const hasSessions = (data.profile?.areas ?? []).some((a) => a.target);
  const goals = data.goals?.month === ctx.today.slice(0, 7) ? data.goals : undefined;
  const hour = new Date().getHours();
  const s = data.settings;
  const reviewDue = new Date().getDay() === 0 && s.reviewWeek !== weekStart(ctx.today);
  const planDue = hour < 14 && s.planDate !== ctx.today && open.length > 0;
  const unfinished = open.filter((t) => (t.due != null && t.due <= ctx.today) || t.focus).length;
  const wrapDue = hour >= 17 && s.wrapDate !== ctx.today && unfinished > 0;
  const setupDue = !data.profile?.setupDone;
  const balance = new Date().getDay() >= 3 || new Date().getDay() === 0 ? balanceNudge(data, ctx.today) : null;
  const balanceDue = !!balance && s.balanceWeek !== weekStart(ctx.today);

  // One banner at a time, most important first. Calm beats complete.
  const nudges: React.ReactNode[] = [];
  if (setupDue)
    nudges.push(<Nudge key="setup" emoji="👋" title="Check your settings (1 minute)" body="Your areas, weekly targets and daily rhythm, so Today can plan around you." action="Open" onAction={() => openPanel("me")} />);
  if (showBackup)
    nudges.push(
      <div key="backup" className="rounded-2xl bg-warn-soft p-4 text-sm">
        <p className="font-medium text-ink">It's been a couple of weeks since your last backup.</p>
        <p className="mt-0.5 text-muted">Everything lives on this device, so a quick export keeps it safe.</p>
        <div className="mt-3 flex gap-2">
          <button
            className={btn.primary}
            onClick={() => {
              exportBackup(data);
              actions.settings({ lastBackupAt: Date.now() });
              ctx.notify("Backup downloaded. Thank you!");
            }}
          >
            Back up now
          </button>
          <button className={btn.ghost} onClick={() => actions.settings({ backupSnoozedUntil: Date.now() + 3 * 86_400_000 })}>
            Later
          </button>
        </div>
      </div>,
    );
  if (reviewDue) nudges.push(<Nudge key="review" emoji="🗓️" title="Sunday review" body="See your week and plan the next one." action="Review" onAction={() => openPanel("review")} />);
  const conscience = computeNudges(data, new Date())[0];
  if (conscience && data.profile?.notify.nudges !== false) {
    nudges.push(
      <div key={"n:" + conscience.id} className="rounded-2xl bg-accent-soft p-3.5">
        <p className="text-[15px] font-semibold text-ink">{conscience.text}</p>
        <div className="mt-2.5 flex gap-2">
          <button
            className={`${btn.primary} min-h-11`}
            onClick={() => {
              if (conscience.kind === "goals") openPanel("goals");
              else if (conscience.kind === "empty-day") onPrefill("");
              else setProgress(true);
            }}
          >
            {conscience.kind === "goals" ? "Set them" : conscience.kind === "empty-day" ? "Add something" : "See my week"}
          </button>
          <button className={`${btn.ghost} min-h-11`} onClick={() => actions.setEntry(nudgeKey(conscience.id, ctx.today), "skip")}>
            Not now
          </button>
        </div>
      </div>,
    );
  }
  if (wrapDue) nudges.push(<Nudge key="wrap" emoji="🌙" title="Wrap up the day" body={`${unfinished} left. Roll them to tomorrow in one tap.`} action="Wrap up" onAction={() => openPanel("evening")} />);
  if (planDue && !hasSessions) nudges.push(<Nudge key="plan" emoji="☀️" title="Plan your day" body="Pick the 3 things that matter today." action="Pick 3" onAction={() => openPanel("morning")} />);
  if (balanceDue && balance)
    nudges.push(
      <div key="balance" className="rounded-2xl bg-warn-soft p-3.5">
        <p className="text-[15px] font-semibold text-ink">⚖️ {balance.message}</p>
        <div className="mt-2.5 flex gap-2">
          <button className={`${btn.primary} min-h-11`} onClick={() => onPrefill(`@${balance.missing[0]} `)}>
            Add one
          </button>
          <button className={`${btn.ghost} min-h-11`} onClick={() => actions.settings({ balanceWeek: weekStart(ctx.today) })}>
            Not now
          </button>
        </div>
      </div>,
    );

  return (
    <div>
      {nudges[0] && <div className="mb-3">{nudges[0]}</div>}

      {goals && goals.items.length > 0 && (
        <section aria-label="This month's must-haves" className="mb-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">🎯 This month</h2>
            <button onClick={() => openPanel("goals")} className="min-h-9 px-1 text-xs text-muted underline-offset-2 hover:underline">
              Edit
            </button>
          </div>
          <ul>
            {goals.items.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => actions.setGoals(goals.month, goals.items.map((x) => (x.id === g.id ? { ...x, done: !x.done } : x)))}
                  className="flex min-h-11 w-full items-center gap-3 text-left"
                  aria-pressed={g.done}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${g.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"}`}>
                    <CheckIcon width={11} height={11} />
                  </span>
                  <span className={`text-[15px] ${g.done ? "text-muted line-through" : "font-medium"}`}>{g.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TodayPlan data={data} ctx={ctx} onProgress={() => setProgress(true)} openPanel={openPanel} />
      {progress && <ProgressSheet data={data} ctx={ctx} onClose={() => setProgress(false)} />}

      {(focus.length > 0 || !hasSessions) && <SectionTitle right={`${focus.length}/${MAX_FOCUS}`}>Your focus</SectionTitle>}
      {focus.length ? (
        <div className="space-y-2.5">
          {focus.map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} big />
          ))}
        </div>
      ) : hasSessions ? null : (
        <Empty>
          {open.length || doneToday.length
            ? "Nothing pinned yet. Tap the target on up to three things that would make today a good day."
            : isNative()
              ? "A clear page. Type or speak a task below. Coming from the web version? Menu → Import JSON brings your tasks across."
              : "A clear page. Type something below to get started. Dates, ! and #tags are understood."}
        </Empty>
      )}

      {dueNow.length > 0 && (
        <>
          <SectionTitle>Due or slipped</SectionTitle>
          <div className="space-y-2">
            {dueNow.map((t) => (
              <TaskCard key={t.id} task={t} ctx={ctx} />
            ))}
          </div>
        </>
      )}

      <EventsStrip data={data} ctx={ctx} onAll={() => openPanel("events")} />

      {open.length > 0 && (
        <div className="mt-6 flex justify-center gap-5 text-sm">
          <button onClick={() => openPanel("plan")} className="min-h-11 font-medium text-accent">
            Plan my tasks
          </button>
          <button onClick={onRescue} className="min-h-11 font-medium text-muted">
            Short on time?
          </button>
          <button onClick={() => openPanel("bored")} className="min-h-11 font-medium text-muted">
            Bored?
          </button>
        </div>
      )}

      {doneToday.length > 0 && (
        <>
          <SectionTitle
            right={
              <button onClick={() => setShowDone((s) => !s)} className="underline-offset-2 hover:underline">
                {showDone ? "Hide" : "Show"}
              </button>
            }
          >
            Done today · {doneToday.length}
          </SectionTitle>
          {showDone ? (
            <div className="space-y-2">
              {doneToday.map((t) => (
                <TaskCard key={t.id} task={t} ctx={ctx} />
              ))}
            </div>
          ) : (
            <p className="px-1 text-sm text-muted">Nice work. {doneToday.length === 1 ? "One thing" : `${doneToday.length} things`} off your plate.</p>
          )}
        </>
      )}
    </div>
  );
}
