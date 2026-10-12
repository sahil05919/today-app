"use client";
import { useMemo } from "react";
import { upcomingDays } from "@/lib/upcoming";
import type { TLItem } from "@/lib/timeline";
import type { AppData, ISODate } from "@/lib/types";

/**
 * A compact look at the next three days, built from the real timeline. Tap a day's heading to open it in the Calendar,
 * or tap any line to open that very thing (a task, a session, an event) and change it.
 */
export function NextDays({ data, today, onOpenDay, onOpenItem }: { data: AppData; today: ISODate; onOpenDay: (day: ISODate) => void; onOpenItem: (it: TLItem, date: ISODate) => void }) {
  const days = useMemo(() => upcomingDays(data, today), [data, today]);
  return (
    <section aria-label="Next 3 days">
      <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Coming up</h2>
      <div className="grid grid-cols-3 gap-2">
        {days.map((d) => (
          <div key={d.date} className="flex min-h-24 min-w-0 flex-col rounded-2xl border border-line bg-surface p-1.5">
            <button onClick={() => onOpenDay(d.date)} aria-label={`${d.label}, ${d.dateText}, ${d.count} items`} className="block min-h-11 w-full rounded-xl px-1 text-left active:scale-[0.98]">
              <span className="flex items-baseline justify-between gap-1">
                <span className="truncate text-[13px] font-semibold">{d.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{d.count}</span>
              </span>
              <span className="block text-[11px] text-muted">{d.dateText}</span>
            </button>
            <span className="mt-0.5 block">
              {d.top.length ? (
                d.top.map((t, i) => (
                  <button key={i} onClick={() => onOpenItem(t.item, d.date)} className="block min-h-9 w-full truncate rounded-lg px-1 text-left text-xs leading-snug active:bg-bg">
                    {t.time && <span className="mr-1 tabular-nums text-muted">{t.time}</span>}
                    {t.title}
                  </button>
                ))
              ) : (
                <span className="block px-1 text-xs text-muted">Free</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
