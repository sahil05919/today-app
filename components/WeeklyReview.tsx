"use client";
import { useMemo } from "react";
import { addDays, dayOfMonth, friendlyDate, weekdayShort } from "@/lib/dates";
import { withRepeats } from "@/lib/series";
import { actions } from "@/lib/store";
import { bestDay, buildDurationModel, completionRate, estimateAccuracy, weekStart } from "@/lib/stats";
import { billReminders } from "@/lib/bills";
import { fromISO } from "@/lib/dates";
import { firstDayWithRoom, pendingForReview } from "@/lib/pileup";
import { planSessions } from "@/lib/schedule";
import { weekProgress } from "@/lib/sessions";
import type { AppData, Task } from "@/lib/types";
import { LearningCard } from "./Learning";
import { LetterCard } from "./LetterCard";
import { YourWeekBody } from "./WeekSummary";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

/**
 * Sunday review: what got done, then anything still pending, which you decide on one by one (next week, a day you pick,
 * or let it go). "All set" unlocks once nothing is left undecided. My patterns lives at the bottom.
 */
export function WeeklyReview({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const tasks = useMemo(() => withRepeats(data, ctx.today).tasks, [data, ctx.today]);
  const nextMonday = addDays(weekStart(ctx.today), 7);
  const nextDays = Array.from({ length: 7 }, (_, i) => addDays(nextMonday, i));
  const open = tasks.filter((t) => t.status === "open");
  const planned = open.filter((t) => t.due != null && t.due >= nextMonday && t.due <= nextDays[6]);
  const pending = pendingForReview(data, ctx.today);
  // Candidates for next week: important or undated ones.
  const candidates = open.filter((t) => !t.due).sort((a, b) => Number(b.important) - Number(a.important)).slice(0, 8);

  // Sessions: how the week went against each target, and what next week looks like.
  const progress = useMemo(() => weekProgress(data, ctx.today), [data, ctx.today]);
  const nextWeek = useMemo(() => planSessions(data, fromISO(nextMonday)), [data, nextMonday]);
  const nextEvents = (data.events ?? []).filter((e) => e.date >= nextMonday && e.date <= nextDays[6]).sort((a, b) => a.date.localeCompare(b.date));
  const nextBills = useMemo(() => billReminders(data, nextMonday, nextDays[6], ctx.today), [data, nextMonday, nextDays]);

  const finish = () => {
    actions.settings({ reviewWeek: weekStart(ctx.today) });
    onClose();
  };
  // Closing with things undecided leaves the review open for later (it isn't marked done).
  const close = pending.length ? onClose : finish;

  const nextWeek1 = (t: Task) => {
    const day = firstDayWithRoom(data, t, nextMonday);
    actions.moveTasks([{ taskId: t.id, to: day }]);
    ctx.notify(`${t.title}: ${friendlyDate(day, ctx.today).toLowerCase()}`);
  };
  const drop = (t: Task) => {
    // Skipping works for every kind (a repeat's day, a carried session, an ordinary task) and gives back an Undo.
    const undo = actions.skipTask(t.id);
    if (undo) ctx.notify("Let go. One less thing.", undo);
  };

  const assign = (t: Task, date: string) => {
    if (date) actions.moveTasks([{ taskId: t.id, to: date }]);
  };

  return (
    <Sheet title="Your week" onClose={close}>
      <div className="space-y-6">
        <YourWeekBody data={data} ctx={ctx} />
        <LearningCard data={data} ctx={ctx} />
        <LetterCard data={data} today={ctx.today} />

        {(progress.length > 0 || nextEvents.length > 0 || nextBills.length > 0) && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Next week at a glance</h3>
            {progress.length > 0 && (
              <p className="text-sm text-muted">
                {nextWeek.filter((s) => !s.done).length} sessions planned:{" "}
                {progress
                  .map((r) => `${r.area.emoji} ${nextWeek.filter((s) => s.areaId === r.area.id).length}/${r.target}`)
                  .join("  ")}
              </p>
            )}
            {nextEvents.length > 0 && (
              <ul className="mt-2 space-y-1 text-[15px]">
                {nextEvents.map((e) => (
                  <li key={e.id}>
                    📌 {e.title} <span className="text-muted">· {weekdayShort(e.date)} {dayOfMonth(e.date)}{e.start ? ` ${e.start}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {nextBills.length > 0 && (
              <ul className="mt-2 space-y-1 text-[15px]">
                {nextBills.map((r) => (
                  <li key={r.bill.id + r.date + r.offset}>
                    {r.bill.kind === "chore" ? "🧹" : "💳"} {r.bill.name} <span className="text-muted">· {weekdayShort(r.date)} {dayOfMonth(r.date)}{r.offset > 0 ? ` (due in ${r.offset}d)` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-1 text-sm font-semibold">Still pending{pending.length ? ` · ${pending.length}` : ""}</h3>
          {pending.length ? (
            <>
              <p className="mb-2 text-sm text-muted">Decide on each one, so nothing drifts into next week by itself.</p>
              <ul className="space-y-2.5">
                {pending.map((t) => (
                  <li key={t.id} className="rounded-2xl border border-line bg-bg p-3">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <Chip tone="warn">{friendlyDate(t.due!, ctx.today)}</Chip>
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button className={`${btn.soft} min-h-11 flex-1 px-2`} onClick={() => nextWeek1(t)}>
                        Next week
                      </button>
                      <select
                        aria-label={`Pick a day for ${t.title}`}
                        value=""
                        onChange={(e) => e.target.value && actions.moveTasks([{ taskId: t.id, to: e.target.value }])}
                        className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-2 text-sm"
                      >
                        <option value="">Pick a day</option>
                        {nextDays.map((d) => (
                          <option key={d} value={d}>
                            {weekdayShort(d)} {dayOfMonth(d)}
                          </option>
                        ))}
                      </select>
                      <button className={`${btn.ghost} min-h-11 px-3`} onClick={() => drop(t)}>
                        Drop
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Nothing is pending. Lovely.</p>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold">Plan next week</h3>
          <p className="mb-2 text-sm text-muted">
            {planned.length ? `${planned.length} already planned. ` : "Nothing planned yet. "}
            Give these a day, or leave them for later.
          </p>
          {candidates.length > 0 && (
            <ul className="space-y-2">
              {candidates.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {t.important && <span className="mr-1 font-bold text-accent">!</span>}
                    {t.title}
                  </span>
                  <select
                    aria-label={`Day for ${t.title}`}
                    value=""
                    onChange={(e) => assign(t, e.target.value)}
                    className="min-h-11 rounded-xl border border-line bg-bg px-2 text-sm"
                  >
                    <option value="">Pick day</option>
                    {nextDays.map((d) => (
                      <option key={d} value={d}>
                        {weekdayShort(d)} {dayOfMonth(d)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex gap-2">
          <button className={`${btn.primary} min-h-12 flex-1`} onClick={finish} disabled={pending.length > 0}>
            {pending.length ? `Decide on ${pending.length} more` : "All set"}
          </button>
        </div>

        <details className="rounded-2xl border border-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            📈 My patterns
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </summary>
          <div className="border-t border-line p-3">
            <PatternsBody tasks={tasks} ctx={ctx} />
          </div>
        </details>
      </div>
    </Sheet>
  );
}

/** "My patterns": completion rate, best day and estimate accuracy. All worked out on this device. */
function PatternsBody({ tasks, ctx }: { tasks: Task[]; ctx: ViewCtx }) {
  const rate = completionRate(tasks, ctx.today, 30);
  const best = bestDay(tasks, ctx.today);
  const acc = estimateAccuracy(tasks);
  const model = buildDurationModel(tasks);

  const Card = ({ title, big, children }: { title: string; big: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-line bg-bg p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{big}</p>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );

  return (
    <div>
      <div className="space-y-3">
        {rate.rate != null ? (
          <Card title="Completion, last 30 days" big={`${Math.round(rate.rate * 100)}%`}>
            {rate.done} finished, {rate.missed} still overdue.{" "}
            {rate.rate >= 0.7 ? "You follow through well." : "Try planning fewer things per day."}
          </Card>
        ) : (
          <Card title="Completion, last 30 days" big="–">
            Finish a few tasks and this fills in.
          </Card>
        )}
        {best ? (
          <Card title="Your best day" big={best.name}>
            {best.count} of your last {best.total} finished tasks landed on a {best.name}. Put the hard stuff there.
          </Card>
        ) : (
          <Card title="Your best day" big="–">
            No clear favourite yet. Keep finishing things and a pattern will show up.
          </Card>
        )}
        {acc ? (
          <Card title="Estimate accuracy" big={`${acc.ratio.toFixed(1)}×`}>
            {acc.ratio > 1.15
              ? `Things usually take you ${acc.ratio.toFixed(1)}× your estimate.`
              : acc.ratio < 0.85
                ? `You usually finish faster than you guess (${acc.ratio.toFixed(1)}×).`
                : "Your estimates are spot on."}{" "}
            {acc.within}% were within 25% ({acc.n} timed tasks).
            {model.multiplier ? " Your day plans already use this." : ""}
          </Card>
        ) : (
          <Card title="Estimate accuracy" big="–">
            Add an estimate (like ~30m) and use “Start” on a few tasks. Today will then learn how long things really take.
          </Card>
        )}
        <p className="px-1 pt-1 text-xs text-muted">Calculated on your phone from your own tasks. Nothing is sent anywhere.</p>
      </div>
    </div>
  );
}
