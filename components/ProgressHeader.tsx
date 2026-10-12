"use client";
import { streak } from "@/lib/progress";
import type { Timeline } from "@/lib/timeline";
import type { AppData } from "@/lib/types";

/**
 * Progress first: the top of Today says how the day is going, before it lists anything. "3 of 5 done today ✅", and a streak
 * line when there is one. Opening the app should feel like "I'm on track", never "why again".
 */
export function ProgressHeader({ data, tl, today }: { data: AppData; tl: Timeline; today: string }) {
  const { done, total } = tl.summary;
  const s = streak(data, today);
  const all = total > 0 && done >= total;
  return (
    <section aria-label="Today's progress" className="px-1">
      <p className="text-[22px] font-semibold leading-tight tracking-tight">
        {total === 0 ? "A light day ✨" : `${done} of ${total} done today ${all ? "✅🎉" : "✅"}`}
      </p>
      {total > 0 && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }} />
        </span>
      )}
      {s.days >= 2 && (
        <p className="mt-1.5 text-sm text-muted">
          🔥 {s.days}-day streak{s.doneToday ? ", and you're on it today" : ". A small one today keeps it going"}
        </p>
      )}
    </section>
  );
}
