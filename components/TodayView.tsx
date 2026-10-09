"use client";
import { useEffect, useMemo, useState } from "react";
import { backupDue, exportBackup } from "@/lib/backup";
import { balanceNudge } from "@/lib/balance";
import { answerFor } from "@/lib/feeling";
import { overload } from "@/lib/load";
import { computeNudges, nudgeKey } from "@/lib/nudges";
import { paceStatus } from "@/lib/pace";
import { pileUp } from "@/lib/pileup";
import { weeklyPercent } from "@/lib/progress";
import { actions } from "@/lib/store";
import { weekStart } from "@/lib/stats";
import { nextUp, type TLItem, type Timeline } from "@/lib/timeline";
import type { AppData, FixedEvent, ISODate } from "@/lib/types";
import { CalendarEventInfo } from "./CalendarSheet";
import { CatchUpCard } from "./CatchUpCard";
import { FreedCard } from "./FreedCard";
import { openCount } from "./itemActions";
import { NextDays } from "./NextDays";
import { SnoozeSheet, type SnoozeTarget } from "./SnoozeSheet";
import { NextUpCard, TimelineList } from "./Timeline";
import { EventSheet, ItemSheet, ProgressSheet } from "./TodayPlan";
import { btn, type Panel, type ViewCtx } from "./ui";

function Nudge({ emoji, title, body, action, onAction }: { emoji: string; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <button onClick={onAction} className="flex w-full items-center gap-3 rounded-2xl bg-warn-soft p-3.5 text-left">
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

/** "Open this card now": a tapped notification or a widget deep link asks the home screen to show a sheet. */
export type OpenRequest = { id: number } & ({ k: "item"; it: TLItem; date: ISODate } | { k: "event"; e: FixedEvent } | { k: "progress" });

type Sheet = { k: "item"; it: TLItem; date: ISODate } | { k: "event"; e: FixedEvent } | { k: "snooze"; target: SnoozeTarget } | { k: "progress" } | null;

/**
 * The home screen, built to be one glance: what's next (with Start / Done / Snooze), your top must-have as one line,
 * then the day as one timeline, then a single "Adjust my day" button. The input lives at the bottom of the app.
 */
export function TodayView({
  data,
  ctx,
  tl,
  now,
  homeNote,
  openPanel,
  onPrefill,
  onCalendar,
  request,
}: {
  data: AppData;
  ctx: ViewCtx;
  tl: Timeline;
  now: Date;
  homeNote?: string | null;
  openPanel: (p: Panel) => void;
  onPrefill: (text: string) => void;
  /** Opens the calendar, on a given day if one is tapped. */
  onCalendar: (day?: ISODate) => void;
  request?: OpenRequest | null;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);

  // A tapped notification lands on its own card.
  useEffect(() => {
    if (!request) return;
    const { id: _id, ...r } = request;
    void _id;
    setSheet(r);
  }, [request]);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const item = useMemo(() => nextUp(tl, nowMin), [tl, nowMin]);
  const goal = (data.goals?.month === ctx.today.slice(0, 7) ? data.goals.items : []).find((g) => !g.done);
  const pct = useMemo(() => weeklyPercent(data, ctx.today), [data, ctx.today]);
  const pace = useMemo(() => paceStatus(data, ctx.today), [data, ctx.today]);
  const hasSessions = (data.profile?.areas ?? []).some((a) => a.target);

  const s = data.settings;
  const reviewDue = now.getDay() === 0 && s.reviewWeek !== weekStart(ctx.today);
  const balance = now.getDay() >= 3 || now.getDay() === 0 ? balanceNudge(data, ctx.today) : null;
  const balanceDue = !!balance && s.balanceWeek !== weekStart(ctx.today);
  const conscience = computeNudges(data, now)[0];
  const pile = useMemo(() => pileUp(data, ctx.today), [data, ctx.today]);
  const heavy = useMemo(() => (s.overloadSkipDate === ctx.today ? null : overload(data, now, ctx.today)), [data, ctx.today, now.getHours(), s.overloadSkipDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // One banner at a time, most important first. Calm beats complete.
  let banner: React.ReactNode = null;
  if (!data.profile?.setupDone) {
    banner = <Nudge emoji="👋" title="Check your settings (1 minute)" body="Your areas, weekly targets and daily rhythm, so Today can plan around you." action="Open" onAction={() => openPanel("me")} />;
  } else if (now.getHours() < 11 && data.profile?.notify.morning !== false && !answerFor(data, ctx.today) && s.feelingSkipDate !== ctx.today) {
    // Before 11:00, until it has been answered: one gentle question, and the day is shaped around the answer.
    banner = (
      <div className="rounded-2xl bg-accent-soft p-3.5">
        <p className="text-[15px] font-semibold text-ink">🌤️ How are you feeling, {ctx.profile.name}?</p>
        <p className="mt-0.5 text-sm text-muted">Tell me, and choose what today holds.</p>
        <div className="mt-2.5 flex gap-2">
          <button className={`${btn.primary} min-h-11`} onClick={() => openPanel("feeling")}>
            Choose my day
          </button>
          <button className={`${btn.ghost} min-h-11`} onClick={() => actions.settings({ feelingSkipDate: ctx.today })}>
            Not now
          </button>
        </div>
      </div>
    );
  } else if (pile.piling && s.catchUpDate !== ctx.today) {
    banner = <CatchUpCard data={data} pile={pile} ctx={ctx} />;
  } else if (heavy) {
    banner = (
      <div className="rounded-2xl bg-warn-soft p-3.5">
        <p className="text-[15px] font-semibold text-ink">{heavy.message}</p>
        <p className="mt-0.5 text-sm text-muted">Pick what matters and the rest moves to days with room.</p>
        <div className="mt-2.5 flex gap-2">
          <button className={`${btn.primary} min-h-11`} onClick={() => openPanel("feeling")}>
            Pick what matters
          </button>
          <button className={`${btn.ghost} min-h-11`} onClick={() => actions.settings({ overloadSkipDate: ctx.today })}>
            Not now
          </button>
        </div>
      </div>
    );
  } else if (backupDue(data)) {
    banner = (
      <div className="rounded-2xl bg-warn-soft p-4 text-sm">
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
      </div>
    );
  } else if (reviewDue) {
    banner = <Nudge emoji="🗓️" title="Sunday review" body="See your week and decide what's still pending." action="Review" onAction={() => openPanel("review")} />;
  } else if (conscience && data.profile?.notify.nudges !== false) {
    banner = (
      <div className="rounded-2xl bg-accent-soft p-3.5">
        <p className="text-[15px] font-semibold text-ink">{conscience.text}</p>
        <div className="mt-2.5 flex gap-2">
          <button
            className={`${btn.primary} min-h-11`}
            onClick={() => {
              if (conscience.kind === "goals") openPanel("goals");
              else if (conscience.kind === "empty-day") onPrefill("");
              else setSheet({ k: "progress" });
            }}
          >
            {conscience.kind === "goals" ? "Set them" : conscience.kind === "empty-day" ? "Add something" : "See my week"}
          </button>
          <button className={`${btn.ghost} min-h-11`} onClick={() => actions.setEntry(nudgeKey(conscience.id, ctx.today), "skip")}>
            Not now
          </button>
        </div>
      </div>
    );
  } else if (balanceDue && balance) {
    banner = (
      <div className="rounded-2xl bg-warn-soft p-3.5">
        <p className="text-[15px] font-semibold text-ink">⚖️ {balance.message}</p>
        <div className="mt-2.5 flex gap-2">
          <button className={`${btn.primary} min-h-11`} onClick={() => onPrefill(`@${balance.missing[0]} `)}>
            Add one
          </button>
          <button className={`${btn.ghost} min-h-11`} onClick={() => actions.settings({ balanceWeek: weekStart(ctx.today) })}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  const open = (it: TLItem) => {
    if (it.taskId) return ctx.open(it.taskId);
    if (it.eventId) {
      const e = [...(data.events ?? []), ...(data.calendarEvents ?? [])].find((x) => x.id === it.eventId);
      if (e) return setSheet({ k: "event", e });
    }
    setSheet({ k: "item", it, date: tl.date });
  };

  const snooze = (it: TLItem) => setSheet({ k: "snooze", target: it.taskId ? { kind: "task", taskId: it.taskId } : { kind: "item", item: it, date: sheet?.k === "item" && sheet.it.key === it.key ? sheet.date : tl.date } });

  return (
    <div className="space-y-4">
      <NextUpCard tl={tl} item={item} data={data} ctx={ctx} nowMin={nowMin} goal={goal} onOpen={open} onSnooze={snooze} onGoals={() => openPanel("goals")} />

      {homeNote && (
        <p className="anim-fade rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">
          {homeNote}
        </p>
      )}
      <FreedCard data={data} ctx={ctx} now={now} />
      {banner}

      <TimelineList tl={tl} ctx={ctx} nowMin={nowMin} onOpen={open} />

      <NextDays data={data} today={ctx.today} onOpenDay={onCalendar} />

      {hasSessions && (
        <button onClick={() => setSheet({ k: "progress" })} className="block w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left" aria-label="This week's progress, tap for details">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-semibold">
              This week {pct.pct}%
              <span className={`ml-2 text-sm font-medium ${pace.status === "behind" ? "text-warn" : "text-accent"}`}>{pace.label}</span>
            </span>
            <span className="text-muted" aria-hidden="true">
              ›
            </span>
          </span>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, pct.pct)}%` }} />
          </span>
        </button>
      )}

      <div className="flex flex-col items-center gap-1 pt-1">
        <button onClick={() => openPanel("adjust")} className={`${btn.soft} min-h-12 w-full text-base`}>
          ✨ Adjust my day
        </button>
        <button onClick={() => openPanel("ideas")} className="min-h-11 px-3 text-sm text-muted underline-offset-2 hover:underline">
          Free time ideas
        </button>
      </div>

      {sheet?.k === "progress" && <ProgressSheet data={data} ctx={ctx} onClose={() => setSheet(null)} onReview={() => (setSheet(null), openPanel("review"))} />}
      {sheet?.k === "item" && <ItemSheet item={sheet.it} date={sheet.date} left={sheet.date === tl.date ? openCount(tl.items, sheet.it.key) : 1} ctx={ctx} onClose={() => setSheet(null)} onSnooze={(it) => snooze(it)} openPanel={openPanel} />}
      {sheet?.k === "event" && (sheet.e.source === "calendar" ? <CalendarEventInfo event={sheet.e} onClose={() => setSheet(null)} /> : <EventSheet event={sheet.e} data={data} ctx={ctx} onClose={() => setSheet(null)} />)}
      {sheet?.k === "snooze" && <SnoozeSheet target={sheet.target} ctx={ctx} onClose={() => setSheet(null)} />}
    </div>
  );
}
