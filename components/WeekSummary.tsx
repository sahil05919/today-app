"use client";
import { useMemo } from "react";
import { addDays, fromISO, rangeLabel } from "@/lib/dates";
import { actions } from "@/lib/store";
import { weekStart } from "@/lib/stats";
import { behind, catchUpSuggestions, compare, focusFor, slipped, soFarText, weekStats, wins, yourWeekText, type AreaRow, type WeekStats } from "@/lib/weekly";
import type { AppData, ISODate, WeekSnapshot } from "@/lib/types";
import { btn, Chip, type ViewCtx } from "./ui";

/** A simple bar: done of target. */
function Bar({ done, target }: { done: number; target: number }) {
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <span className={`block h-full rounded-full transition-all ${done >= target ? "bg-accent" : "bg-accent/60"}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Every area with a weekly target: "Power BI 3/4" and its bar. `arrows` adds ↑ ↓ against last week. */
export function AreaBars({ rows, arrows }: { rows: Array<Pick<AreaRow, "id" | "name" | "emoji" | "done" | "target">>; arrows?: Record<string, "↑" | "↓" | "="> }) {
  return (
    <ul className="space-y-3">
      {rows.map((a) => (
        <li key={a.id}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[15px] font-medium">
              <span aria-hidden="true">{a.emoji}</span> {a.name}
            </p>
            <p className="shrink-0 text-sm tabular-nums">
              <span className={a.done >= a.target ? "font-semibold text-accent" : "text-muted"}>
                {a.done >= a.target ? "✓ " : ""}
                {a.done}/{a.target}
              </span>
              {arrows?.[a.id] && arrows[a.id] !== "=" && (
                <span className={`ml-2 font-semibold ${arrows[a.id] === "↑" ? "text-accent" : "text-warn"}`} aria-label={arrows[a.id] === "↑" ? "up on last week" : "down on last week"}>
                  {arrows[a.id]}
                </span>
              )}
            </p>
          </div>
          <Bar done={a.done} target={a.target} />
        </li>
      ))}
    </ul>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{children}</h3>;

/** Friday: "Week so far". Nothing here changes your plan unless you tap an Add button. */
export function WeekSoFarBody({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const now = useMemo(() => new Date(), []);
  const stats = useMemo(() => weekStats(data, ctx.today, ctx.today), [data, ctx.today]);
  const suggestions = useMemo(() => catchUpSuggestions(data, now), [data, now]);
  const text = soFarText(stats, ctx.profile.name || "friend", suggestions);
  const added = (c: { areaId: string; date: ISODate }) => data.tasks.some((t) => t.status === "open" && t.countsFor === c.areaId && t.due === c.date && t.generated);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-lg font-semibold leading-snug">{text.headline}</p>
        {stats.areas.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            {stats.percent}% of this week's sessions so far · {rangeLabel(stats.week, addDays(stats.week, 6))}
          </p>
        )}
      </div>

      {stats.areas.length > 0 && (
        <section aria-label="Sessions this week">
          <AreaBars rows={stats.areas} />
        </section>
      )}

      <section aria-label="What's behind">
        <H>What's behind</H>
        {text.lines.map((l, i) => (
          <p key={i} className="mb-1.5 text-[15px] leading-relaxed">
            {l}
          </p>
        ))}
        {suggestions.length > 0 && (
          <ul className="mt-2 space-y-2">
            {suggestions.map((c) => (
              <li key={c.areaId} className="flex items-center gap-3 rounded-2xl border border-line bg-bg p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {c.emoji} {c.name} session
                  </span>
                  <span className="text-xs text-muted">{c.minutes} min · a light weekend</span>
                </span>
                {added(c) ? (
                  <Chip tone="accent">Added</Chip>
                ) : (
                  <button
                    className={`${btn.soft} min-h-11 shrink-0`}
                    onClick={() => {
                      const undo = actions.addCatchUp(c, new Date());
                      ctx.notify(`${c.name} added on ${fromISO(c.date).getDay() === 6 ? "Saturday" : "Sunday"}`, undo ?? undefined);
                    }}
                  >
                    {c.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <MoreFacts stats={stats} />
    </div>
  );
}

/** The repeating tasks of the week, in one quiet line each. */
function MoreFacts({ stats }: { stats: WeekStats }) {
  if (!stats.repeats.length) return null;
  return (
    <section aria-label="Daily things">
      <H>Daily things</H>
      <ul className="space-y-1 text-[15px]">
        {stats.repeats.map((r) => (
          <li key={r.title} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">↻ {r.title}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {r.done} of {r.expected}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sunday: "Your week": wins, slipped, your own tasks, events handled, against last week, and next week's focus. */
export function YourWeekBody({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const stats = useMemo(() => weekStats(data, ctx.today, ctx.today), [data, ctx.today]);
  const prev = useMemo(() => weekStats(data, addDays(weekStart(ctx.today), -7), ctx.today), [data, ctx.today]);
  const text = yourWeekText(stats, prev, ctx.profile.name || "friend");
  const w = wins(stats);
  const sl = behind(stats);
  const arrows = Object.fromEntries(compare(stats, prev).map((c) => [c.id, c.arrow])) as Record<string, "↑" | "↓" | "=">;
  const focus = focusFor(stats);
  const nextWeek = addDays(stats.week, 7);
  const applied = data.settings.focus?.week === nextWeek && focus.length > 0 && focus.every((a) => data.settings.focus!.areas.includes(a.id));

  return (
    <div className="space-y-5">
      <p className="text-lg font-semibold leading-snug">{text.headline}</p>

      {stats.areas.length > 0 && (
        <section aria-label="Sessions this week">
          <AreaBars rows={stats.areas} arrows={arrows} />
          <p className="mt-2 text-xs text-muted">↑ ↓ compare with last week.</p>
        </section>
      )}

      {(w.length > 0 || sl.length > 0) && (
        <section aria-label="Wins and what slipped" className="grid gap-3 sm:grid-cols-2">
          {w.length > 0 && (
            <div className="rounded-2xl bg-accent-soft p-3.5">
              <H>Wins</H>
              <p className="text-[15px] font-medium">{w.map((a) => `${a.emoji} ${a.name}`).join(", ")}</p>
              <p className="mt-0.5 text-xs text-muted">At or above target.</p>
            </div>
          )}
          {sl.length > 0 && (
            <div className="rounded-2xl bg-warn-soft p-3.5">
              <H>Slipped</H>
              <p className="text-[15px] font-medium">{slipped(stats).map((a) => `${a.emoji} ${a.name} ${a.done}/${a.target}`).join(", ")}</p>
              <p className="mt-0.5 text-xs text-muted">Good to know. Next week can be planned around it.</p>
            </div>
          )}
        </section>
      )}

      <OwnAndEvents own={stats.own} events={stats.events} />
      <MoreFacts stats={stats} />

      <section aria-label="Focus for next week" className="rounded-2xl border border-line p-3.5">
        <H>Focus for next week</H>
        {focus.length ? (
          <>
            <p className="text-[15px] font-medium">{focus.map((a) => `${a.emoji} ${a.name}`).join(" and ")}</p>
            <p className="mt-0.5 text-sm text-muted">The lowest done-to-target this week. Applying it gives them the earliest days of next week.</p>
            {applied ? (
              <p className="mt-2 text-sm font-medium text-accent">✓ Applied. Next week's plan leans on {focus.map((a) => a.name).join(" and ")}.</p>
            ) : (
              <button
                className={`${btn.primary} mt-2.5 min-h-12 w-full`}
                onClick={() => {
                  actions.applyFocus(nextWeek, focus.map((a) => a.id));
                  ctx.notify("Next week's plan will lean on them", () => actions.applyFocus(nextWeek, []));
                }}
              >
                Apply focus
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">No area needs extra focus. Keep the rhythm going.</p>
        )}
      </section>
    </div>
  );
}

function OwnAndEvents({ own, events }: { own: WeekStats["own"]; events: WeekStats["events"] }) {
  return (
    <>
      <section aria-label="Your own tasks">
        <H>Your own tasks</H>
        <p className="text-[15px]">
          You added {own.added}, finished {own.finished}.
        </p>
        {own.names.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[15px]">
            {own.names.slice(0, 8).map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">✓</span>
                <span className="min-w-0 truncate">{n}</span>
              </li>
            ))}
            {own.names.length > 8 && <li className="text-sm text-muted">…and {own.names.length - 8} more</li>}
          </ul>
        )}
        {own.stillOpen.length > 0 && <p className="mt-1.5 text-sm text-muted">Still open: {own.stillOpen.slice(0, 4).join(", ")}</p>}
      </section>
      {events.handled > 0 && (
        <section aria-label="Calendar events handled">
          <H>Calendar events handled</H>
          <ul className="space-y-0.5 text-[15px]">
            {events.names.slice(0, 8).map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">✓</span>
                <span className="min-w-0 truncate">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A saved week, read back from its snapshot. */
export function SnapshotBody({ snap }: { snap: WeekSnapshot }) {
  return (
    <div className="space-y-4">
      {snap.text && (
        <div className="space-y-1.5">
          {snap.text.split("\n").map((l, i) => (
            <p key={i} className={i === 0 ? "text-[17px] font-semibold leading-snug" : "text-[15px] leading-relaxed text-muted"}>
              {l}
            </p>
          ))}
        </div>
      )}
      {snap.areas.length > 0 && <AreaBars rows={snap.areas} />}
      <OwnAndEvents own={{ ...snap.own, stillOpen: [] }} events={snap.events} />
      {snap.kind === "your-week" && snap.focus.length > 0 && (
        <p className="text-sm text-muted">
          Focus chosen for the next week: {snap.focus.map((id) => snap.areas.find((a) => a.id === id)?.name ?? id).join(", ")}.
        </p>
      )}
    </div>
  );
}
