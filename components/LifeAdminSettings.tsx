"use client";
import { LIFE_ITEMS, lifeOn } from "@/lib/lifeAdmin";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";

/** Settings → Life admin: every item of the pack, all on by default, each with its own switch. */
export function LifeAdminSettings({ data }: { data: AppData }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Flexible to-dos on their day, with one reminder at 19:00 only if still open. A missed one rolls forward once, then drops (the history keeps it).
      </p>
      <ul className="space-y-1.5">
        {LIFE_ITEMS.map((i) => {
          const on = lifeOn(data, i.id);
          return (
            <li key={i.id}>
              <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{i.title}</span>
                  <span className="block text-xs text-muted">
                    {i.when} · {i.minutes} min
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const s = (data.series ?? []).find((x) => x.lifeId === i.id);
                    if (e.target.checked && !s) actions.ensureLife(i.id);
                    else if (s) actions.setSeriesOff(s.id, !e.target.checked);
                  }}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">Clean room (every 3 days), Grocery run (Sat), Finance review and Call family (Sun) are in Bills &amp; chores, so they are not repeated here.</p>
    </div>
  );
}
