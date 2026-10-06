"use client";
import { useState } from "react";
import { backupDue, exportBackup } from "@/lib/backup";
import { diffDays, toISO } from "@/lib/dates";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { balanceNudge } from "@/lib/balance";
import { isNative } from "@/lib/platform";
import { weekStart } from "@/lib/stats";
import { EventsStrip } from "./EventsSheet";
import { TaskCard } from "./TaskCard";
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
  const open = data.tasks.filter((t) => t.status === "open");
  const focus = sortTasks(open.filter((t) => t.focus));
  const dueNow = sortTasks(open.filter((t) => !t.focus && t.due != null && diffDays(t.due, ctx.today) <= 0));
  const doneToday = data.tasks
    .filter((t) => t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) === ctx.today)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const showBackup = backupDue(data);
  const hour = new Date().getHours();
  const s = data.settings;
  const reviewDue = new Date().getDay() === 0 && s.reviewWeek !== weekStart(ctx.today);
  const planDue = hour < 14 && s.planDate !== ctx.today && open.length > 0;
  const unfinished = open.filter((t) => (t.due != null && t.due <= ctx.today) || t.focus).length;
  const wrapDue = hour >= 17 && s.wrapDate !== ctx.today && unfinished > 0;
  const setupDue = !data.profile?.setupDone;
  const balance = new Date().getDay() >= 3 || new Date().getDay() === 0 ? balanceNudge(data, ctx.today) : null;
  const balanceDue = !!balance && s.balanceWeek !== weekStart(ctx.today);

  return (
    <div>
      {showBackup && (
        <div className="mb-2 rounded-2xl bg-warn-soft p-4 text-sm">
          <p className="font-medium text-ink">A gentle nudge: it's been a couple of weeks since your last backup.</p>
          <p className="mt-0.5 text-muted">Your tasks only live on this device, so a quick export keeps them safe.</p>
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
              Remind me later
            </button>
          </div>
        </div>
      )}

      {setupDue && (
        <Nudge
          emoji="👋"
          title="Set up Me (1 minute)"
          body="Your work hours, routines and notification times, so Today can work around your day."
          action="Set up"
          onAction={() => openPanel("me")}
        />
      )}
      {balanceDue && balance && (
        <div className="mb-2 rounded-2xl bg-warn-soft p-3.5">
          <p className="text-[15px] font-semibold text-ink">⚖️ {balance.message}</p>
          <p className="text-sm text-muted">Add one small thing for yourself this week?</p>
          <div className="mt-2.5 flex gap-2">
            <button
              className={`${btn.primary} min-h-11`}
              onClick={() => onPrefill(`@${balance.missing[0]} `)}
            >
              Add one
            </button>
            <button className={`${btn.ghost} min-h-11`} onClick={() => actions.settings({ balanceWeek: weekStart(ctx.today) })}>
              Not now
            </button>
          </div>
        </div>
      )}
      {reviewDue &&<Nudge emoji="🗓️" title="Sunday review" body="See your week and plan the next one." action="Review" onAction={() => openPanel("review")} />}
      {planDue && !reviewDue && <Nudge emoji="☀️" title="Plan your day" body="Pick the 3 things that matter today." action="Pick 3" onAction={() => openPanel("morning")} />}
      {wrapDue && <Nudge emoji="🌙" title="Wrap up the day" body={`${unfinished} left. Roll them to tomorrow in one tap.`} action="Wrap up" onAction={() => openPanel("evening")} />}

      <SectionTitle right={`${focus.length}/${MAX_FOCUS}`}>Your focus</SectionTitle>
      {focus.length ? (
        <div className="space-y-2.5">
          {focus.map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} big />
          ))}
        </div>
      ) : (
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
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => openPanel("plan")} className={`${btn.primary} min-h-12`}>
            Plan my day
          </button>
          <button onClick={onRescue} className={`${btn.soft} min-h-12`}>
            Short on time? Rescue
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
