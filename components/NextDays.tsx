"use client";
import { useMemo } from "react";
import { upcomingDays } from "@/lib/upcoming";
import type { AppData, ISODate } from "@/lib/types";

/** A compact look at the next three days, built from the real timeline. Tap a day to open it in the Calendar. */
export function NextDays({ data, today, onOpenDay }: { data: AppData; today: ISODate; onOpenDay: (day: ISODate) => void }) {
  const days = useMemo(() => upcomingDays(data, today), [data, today]);
  return (
    <section aria-label="Next 3 days">
      <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Coming up</h2>
      <div className="grid grid-cols-3 gap-2">
        {days.map((d) => (
          <button key={d.date} onClick={() => onOpenDay(d.date)} aria-label={`${d.label}, ${d.dateText}, ${d.count} items`} className="flex min-h-24 min-w-0 flex-col rounded-2xl border border-line bg-surface p-2.5 text-left active:scale-[0.98]">
            <span className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[13px] font-semibold">{d.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">{d.count}</span>
            </span>
            <span className="text-[11px] text-muted">{d.dateText}</span>
            <span className="mt-1.5 space-y-0.5">
              {d.top.length ? (
                d.top.map((t, i) => (
                  <span key={i} className="block truncate text-xs leading-snug">
                    {t.time && <span className="mr-1 tabular-nums text-muted">{t.time}</span>}
                    {t.title}
                  </span>
                ))
              ) : (
                <span className="block text-xs text-muted">Free</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
