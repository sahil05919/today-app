"use client";
import { useMemo } from "react";
import { addDays, dayOfMonth, formatMinutes, friendlyDate, weekdayShort } from "@/lib/dates";
import { actions } from "@/lib/store";
import { bestDay, buildDurationModel, completionRate, estimateAccuracy, weekStart, weekSummary } from "@/lib/stats";
import type { Task } from "@/lib/types";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

/** Sunday review: what got done, what slipped, and a quick plan for next week. */
export function WeeklyReview({
  tasks,
  ctx,
  onClose,
  onPatterns,
}: {
  tasks: Task[];
  ctx: ViewCtx;
  onClose: () => void;
  onPatterns: () => void;
}) {
  const sum = useMemo(() => weekSummary(tasks, ctx.today), [tasks, ctx.today]);
  const nextMonday = addDays(weekStart(ctx.today), 7);
  const nextDays = Array.from({ length: 7 }, (_, i) => addDays(nextMonday, i));
  const open = tasks.filter((t) => t.status === "open");
  const planned = open.filter((t) => t.due != null && t.due >= nextMonday && t.due <= nextDays[6]);
  const slipped = sum.slipped.slice(0, 6);
  // Candidates for next week: slipped tasks, then important or undated ones.
  const candidates = [
    ...sum.slipped,
    ...open.filter((t) => !t.due && !sum.slipped.includes(t)).sort((a, b) => Number(b.important) - Number(a.important)),
  ].slice(0, 8);

  const close = () => {
    actions.settings({ reviewWeek: weekStart(ctx.today) });
    onClose();
  };

  const assign = (t: Task, date: string) => {
    if (date) actions.update(t.id, { due: date, focus: false });
  };

  return (
    <Sheet title="Your week" onClose={close}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Done this week</h3>
          {sum.done.length ? (
            <>
              <p className="text-sm text-muted">
                {sum.done.length} {sum.done.length === 1 ? "thing" : "things"} finished
                {sum.minutes ? `, ${formatMinutes(sum.minutes)} of tracked focus` : ""}. That counts.
              </p>
              <ul className="mt-2 space-y-1 text-[15px]">
                {sum.done.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex gap-2">
                    <span className="text-accent">✓</span>
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
                {sum.done.length > 5 && <li className="text-sm text-muted">…and {sum.done.length - 5} more</li>}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Nothing ticked off yet this week, and that's fine. A fresh week is coming.</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Slipped</h3>
          {slipped.length ? (
            <ul className="space-y-1.5">
              {slipped.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[15px]">
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <Chip tone="warn">{friendlyDate(t.due!, ctx.today)}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing is overdue. Lovely.</p>
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
          <button className={`${btn.primary} min-h-12 flex-1`} onClick={close}>
            All set
          </button>
          <button className={`${btn.ghost} min-h-12`} onClick={onPatterns}>
            My patterns
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** "My patterns": completion rate, best day and estimate accuracy. All worked out on this device. */
export function Patterns({ tasks, ctx, onClose }: { tasks: Task[]; ctx: ViewCtx; onClose: () => void }) {
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
    <Sheet title="My patterns" onClose={onClose}>
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
            {model.multiplier ? " Rescue my day already uses this." : ""}
          </Card>
        ) : (
          <Card title="Estimate accuracy" big="–">
            Add an estimate (like ~30m) and use “Start timer” on a few tasks. Rescue will then learn how long things really take.
          </Card>
        )}
        <p className="px-1 pt-1 text-xs text-muted">Calculated on your phone from your own tasks. Nothing is sent anywhere.</p>
      </div>
    </Sheet>
  );
}
