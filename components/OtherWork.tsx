"use client";
import { useState } from "react";
import { fmtMinutes, otherLine, otherWeek, SUBS } from "@/lib/other";
import { actions } from "@/lib/store";
import type { AppData, SubLabel } from "@/lib/types";
import { Sheet, type ViewCtx } from "./ui";

const SUB_EMOJI: Record<SubLabel, string> = { Building: "🛠️", Chores: "🧹", Admin: "📋", Learning: "📚", Other: "•" };

/** The "Other" row of the week view: everything productive that is not one of the tracked areas, as one line. Tap for the breakdown. */
export function OtherRow({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const [open, setOpen] = useState(false);
  const w = otherWeek(data, ctx.today);
  const pct = w.target ? Math.min(100, Math.round((w.minutes / w.target) * 100)) : w.minutes ? 100 : 0;
  return (
    <li>
      <button onClick={() => setOpen(true)} className="block w-full text-left" aria-label={`${otherLine(w)}. Tap for the breakdown`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold">🧩 {otherLine(w)}</p>
          <span className="text-muted" aria-hidden="true">
            ›
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">Your own tasks, chores, life admin, Gmail tasks, ticked events and time you logged</p>
      </button>
      {open && <OtherSheet data={data} ctx={ctx} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** Other, by sub-label, with the items; each item's label can be changed. */
export function OtherSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const w = otherWeek(data, ctx.today);
  return (
    <Sheet title="Other this week" onClose={onClose}>
      <p className="-mt-1 mb-4 text-[15px]">
        <span className="text-2xl font-semibold tabular-nums">{fmtMinutes(w.minutes)}</span>
        {w.target ? <span className="ml-2 text-muted">of {fmtMinutes(w.target)}</span> : null}
        {w.bonus ? <span className="ml-2 font-medium text-accent">+{fmtMinutes(w.bonus)} extra 💪</span> : null}
      </p>
      {w.entries.length === 0 && <p className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">Nothing yet. Finish your own tasks, or type something like “spent 2 hrs building the app”.</p>}
      <div className="space-y-4">
        {w.bySub.map((g) => (
          <section key={g.sub} aria-label={g.sub}>
            <h3 className="mb-1 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted">
              <span>
                {SUB_EMOJI[g.sub]} {g.sub}
              </span>
              <span className="tabular-nums">{fmtMinutes(g.minutes)}</span>
            </h3>
            <ul className="space-y-1">
              {g.entries.map((e) => (
                <li key={e.key} className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{fmtMinutes(e.minutes)}</span>
                  <select
                    aria-label={`Label for ${e.title}`}
                    value={e.sub}
                    onChange={(ev) => actions.setOtherLabel(e.key, ev.target.value as SubLabel)}
                    className="shrink-0 rounded-lg border border-line bg-surface px-1 py-1 text-xs"
                  >
                    {SUBS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {e.source === "logged" && (
                    <button aria-label={`Delete ${e.title}`} className="-mr-1 min-h-9 px-1.5 text-muted" onClick={() => actions.removeWorkLog(e.key.slice(4))}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
