"use client";
import { useMemo, useState } from "react";
import { addDays, rangeLabel } from "@/lib/dates";
import { weekStart } from "@/lib/stats";
import type { AppData, WeekSnapshot } from "@/lib/types";
import { SnapshotBody, WeekSoFarBody } from "./WeekSummary";
import { Chip, Sheet, type Panel, type ViewCtx } from "./ui";

/** Friday's sheet. Closing it also puts the Friday banner away for this week. */
export function WeekSoFarSheet({ data, ctx, onClose, onDone }: { data: AppData; ctx: ViewCtx; onClose: () => void; onDone: () => void }) {
  return (
    <Sheet
      title="Week so far"
      onClose={() => {
        onDone();
        onClose();
      }}
    >
      <WeekSoFarBody data={data} ctx={ctx} />
    </Sheet>
  );
}

/** One row per past week: its saved "Your week" (or "Week so far"), newest first. Tap a week to read it. */
export function ReviewsSheet({ data, ctx, onClose, openPanel }: { data: AppData; ctx: ViewCtx; onClose: () => void; openPanel: (p: Panel) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const thisWeek = weekStart(ctx.today);
  // One entry per week: "Your week" wins over "Week so far".
  const weeks = useMemo(() => {
    const by = new Map<string, WeekSnapshot>();
    for (const w of data.weeks ?? []) {
      const have = by.get(w.week);
      if (!have || (have.kind === "week-so-far" && w.kind === "your-week")) by.set(w.week, w);
    }
    return [...by.values()].sort((a, b) => b.week.localeCompare(a.week));
  }, [data.weeks]);
  const pct = (w: WeekSnapshot) => {
    const t = w.areas.reduce((n, a) => n + a.target, 0);
    return t ? Math.round((w.areas.reduce((n, a) => n + Math.min(a.done, a.target), 0) / t) * 100) : null;
  };

  return (
    <Sheet title="Weekly review" onClose={onClose}>
      <div className="space-y-2">
        <button
          onClick={() => {
            onClose();
            openPanel(new Date().getDay() === 0 ? "review" : "sofar");
          }}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{new Date().getDay() === 0 ? "Your week" : "This week so far"}</span>
            <span className="text-xs text-muted">{rangeLabel(thisWeek, addDays(thisWeek, 6))} · live</span>
          </span>
          <span aria-hidden="true" className="text-muted">
            ›
          </span>
        </button>

        {weeks.filter((w) => w.week !== thisWeek || w.kind === "your-week").length === 0 && weeks.length === 0 && (
          <p className="px-1 pt-2 text-sm text-muted">Past weeks appear here once they are over, each saved the way it looked on Sunday.</p>
        )}

        {weeks.map((w) => (
          <div key={w.week} className="rounded-2xl border border-line">
            <button onClick={() => setOpen(open === w.week ? null : w.week)} aria-expanded={open === w.week} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{rangeLabel(w.week, addDays(w.week, 6))}</span>
                <span className="text-xs text-muted">{w.kind === "your-week" ? "Your week" : "Week so far"}</span>
              </span>
              {pct(w) != null && <Chip tone={pct(w)! >= 80 ? "accent" : "plain"}>{pct(w)}%</Chip>}
              <span aria-hidden="true" className="text-muted">
                {open === w.week ? "▴" : "▾"}
              </span>
            </button>
            {open === w.week && (
              <div className="border-t border-line p-4">
                <SnapshotBody snap={w} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
