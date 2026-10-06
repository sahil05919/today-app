"use client";
import { useMemo } from "react";
import { dots, encouragement, streak, weeklyPercent } from "@/lib/progress";
import { weekProgress } from "@/lib/sessions";
import type { AppData } from "@/lib/types";
import type { ViewCtx } from "./ui";

const R = 40;
const CIRC = 2 * Math.PI * R;

/** One ring: how much of this week's targets are done. */
function Ring({ pct }: { pct: number }) {
  return (
    <svg width="84" height="84" viewBox="0 0 100 100" role="img" aria-label={`${pct}% of this week's sessions done`} className="shrink-0">
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--line)" strokeWidth="10" />
      <circle
        cx="50"
        cy="50"
        r={R}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={CIRC * (1 - Math.min(100, pct) / 100)}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="50" y="57" textAnchor="middle" fontSize="24" fontWeight="600" fill="var(--ink)">
        {pct}%
      </text>
    </svg>
  );
}

/**
 * Progress at a glance, and nothing else: the ring, one row of dots per area, the streak and one kind line.
 * No charts. Tap anywhere on it for the details.
 */
export function ProgressCard({ data, ctx, onOpen, onGoals }: { data: AppData; ctx: ViewCtx; onOpen: () => void; onGoals: () => void }) {
  const rows = useMemo(() => weekProgress(data, ctx.today), [data, ctx.today]);
  const { pct } = useMemo(() => weeklyPercent(data, ctx.today), [data, ctx.today]);
  const run = useMemo(() => streak(data, ctx.today), [data, ctx.today]);
  const line = useMemo(() => encouragement(data, ctx.today), [data, ctx.today]);
  const goals = data.goals?.month === ctx.today.slice(0, 7) ? data.goals.items : [];
  if (!rows.length) return null;

  return (
    <section aria-label="Progress" className="rounded-2xl border border-line bg-surface p-4">
      <button onClick={onOpen} className="block w-full text-left" aria-label="This week's progress, tap for details">
        <div className="flex items-center gap-4">
          <Ring pct={pct} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight">This week: {pct}%</p>
            <p className="mt-0.5 text-sm font-medium text-accent">
              {run.days > 0 ? `🔥 ${run.days} ${run.days === 1 ? "day" : "days"} in a row` : "Start a streak today"}
            </p>
            <p className="mt-1 text-sm leading-snug text-muted">{line}</p>
          </div>
        </div>

        <ul className="mt-3.5 space-y-1.5">
          {rows.map((r) => {
            const d = dots(r);
            return (
              <li key={r.area.id} className="flex items-center gap-2 text-[15px]">
                <span className="w-5 shrink-0 text-center" aria-hidden="true">
                  {r.area.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.area.name}</span>
                <span className="shrink-0 tracking-[0.18em]" aria-hidden="true">
                  {Array.from({ length: d.total }, (_, i) => (
                    <span key={i} className={i < d.filled ? "text-accent" : "text-line"}>
                      {i < d.filled ? "●" : "○"}
                    </span>
                  ))}
                </span>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">
                  {r.done}/{r.target}
                </span>
                <span className="sr-only">
                  {r.area.name}: {r.done} of {r.target}
                </span>
              </li>
            );
          })}
        </ul>
      </button>

      {goals.length > 0 && (
        <button onClick={onGoals} className="mt-3 flex min-h-11 w-full items-center gap-2 border-t border-line pt-3 text-left text-sm">
          <span aria-hidden="true">🎯</span>
          <span className="min-w-0 flex-1 truncate">{goals.find((g) => !g.done)?.text ?? "All of this month's must-haves are done"}</span>
          <span className="text-xs tabular-nums text-muted">
            {goals.filter((g) => g.done).length}/{goals.length}
          </span>
        </button>
      )}
    </section>
  );
}
