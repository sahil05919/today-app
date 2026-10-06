"use client";
import { useState } from "react";
import { backupDue, exportBackup } from "@/lib/backup";
import { diffDays, toISO } from "@/lib/dates";
import { OFF_LIMIT_MESSAGE, MAX_OFF_DAYS, isOffDay, offDaysLeft } from "@/lib/offday";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { balanceNudge } from "@/lib/balance";
import { computeNudges, nudgeKey } from "@/lib/nudges";
import { isNative } from "@/lib/platform";
import { weekStart } from "@/lib/stats";
import { Capture, type CaptureCommand } from "./Capture";
import { ProgressCard } from "./ProgressCard";
import { TaskCard } from "./TaskCard";
import { ProgressSheet, TodayPlan } from "./TodayPlan";
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

/**
 * The home screen, built to be one glance and one button:
 * progress on top, then the big input (type or speak), then today's list. Everything else lives in the menu.
 */
export function TodayView({
  data,
  ctx,
  command,
  openPanel,
  onPrefill,
}: {
  data: AppData;
  ctx: ViewCtx;
  command?: CaptureCommand;
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

  const left = offDaysLeft(data, ctx.today);
  const off = isOffDay(data, ctx.today);
  const takeOff = () => {
    if (actions.takeOffDay(ctx.today)) ctx.notify("Off day. Today is lighter, and the rest moves later in the week.", () => actions.cancelOffDay(ctx.today));
  };

  return (
    <div className="space-y-3.5">
      {nudges[0]}

      <ProgressCard data={data} ctx={ctx} onOpen={() => setProgress(true)} onGoals={() => openPanel("goals")} />
      {progress && <ProgressSheet data={data} ctx={ctx} onClose={() => setProgress(false)} />}

      <Capture ctx={ctx} data={data} command={command} />

      <TodayPlan data={data} ctx={ctx} openPanel={openPanel} />

      {(focus.length > 0 || dueNow.length > 0) && (
        <div className="space-y-2">
          {[...focus, ...dueNow].map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} big={t.focus} />
          ))}
        </div>
      )}

      {!hasSessions && open.length === 0 && doneToday.length === 0 && (
        <Empty>
          {isNative()
            ? "A clear page. Type or speak a task above. Coming from the web version? Menu → Import JSON brings your tasks across."
            : "A clear page. Type or speak something above. I'll work out the day, the time and where it belongs."}
        </Empty>
      )}

      {/* Off day: at most two a week. */}
      <div className="flex flex-col items-center gap-1.5 pt-1 text-center">
        {off ? (
          <>
            <p className="text-sm text-muted">🌿 Off day. Today is lighter: one small session, the rest moves on.</p>
            <button className="min-h-11 px-3 text-sm font-medium text-accent" onClick={() => actions.cancelOffDay(ctx.today)}>
              Actually, I'll do today
            </button>
          </>
        ) : (
          <>
            <button
              onClick={takeOff}
              disabled={left === 0}
              aria-describedby="off-left"
              className="min-h-11 rounded-xl border border-line bg-surface px-5 text-sm font-medium disabled:opacity-45"
            >
              🌿 Take an off day
            </button>
            <p id="off-left" className="text-xs text-muted">
              Off days left: {left} of {MAX_OFF_DAYS}
            </p>
            {left === 0 && <p className="max-w-xs text-sm text-ink">{OFF_LIMIT_MESSAGE}</p>}
          </>
        )}
      </div>

      {doneToday.length > 0 && (
        <div className="pt-1">
          <button onClick={() => setShowDone((v) => !v)} className="min-h-11 text-sm text-muted underline-offset-2 hover:underline">
            Done today · {doneToday.length} {showDone ? "(hide)" : "(show)"}
          </button>
          {showDone && (
            <div className="mt-1 space-y-2">
              {doneToday.map((t) => (
                <TaskCard key={t.id} task={t} ctx={ctx} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
