"use client";
import { useMemo, useState } from "react";
import { actions } from "@/lib/store";
import { dayChoices, shortLine, weekTargets } from "@/lib/targets";
import { weekStart } from "@/lib/stats";
import { withDefaults } from "@/lib/profile";
import type { AppData } from "@/lib/types";
import { btn, Sheet, type ViewCtx } from "./ui";

/**
 * Weekly targets are a hard rule: the planner places every session it can. When one truly cannot fit, it is said plainly,
 * never dropped quietly: "Power BI: 2 of 4 fit this week. Tap to choose".
 */
export function useShortfalls(data: AppData, now: Date) {
  const minute = Math.floor(now.getTime() / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => weekTargets(data, new Date(minute * 60_000)), [data, minute]);
  const week = weekStart(t.week);
  const set = data.settings.shortDismissed?.week === week ? data.settings.shortDismissed.areas : [];
  return t.short.filter((s) => !set.includes(s.areaId));
}

export function ShortfallCard({ data, ctx, now }: { data: AppData; ctx: ViewCtx; now: Date }) {
  const short = useShortfalls(data, now);
  const [open, setOpen] = useState(false);
  if (!short.length) return null;
  const first = short[0];
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-2xl bg-warn-soft p-3.5 text-left">
        <span className="text-2xl" aria-hidden="true">
          🗓️
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{shortLine(first)}</span>
          {short.length > 1 && <span className="block text-sm text-muted">and {short.length - 1} more {short.length === 2 ? "area" : "areas"}</span>}
        </span>
        <span className="shrink-0 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink">Choose</span>
      </button>
      {open && <ShortfallSheet data={data} ctx={ctx} now={now} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShortfallSheet({ data, ctx, now, onClose }: { data: AppData; ctx: ViewCtx; now: Date; onClose: () => void }) {
  const short = useShortfalls(data, now);
  const areas = withDefaults(data.profile).areas;
  const week = weekStart(ctx.today);
  return (
    <Sheet title="This week's targets" onClose={onClose}>
      <p className="-mt-1 mb-3 text-sm text-muted">Everything that fits is already planned. For the rest, pick a day to add one more, or leave it for this week.</p>
      {short.length === 0 && <p className="py-4 text-center text-[15px]">All sorted 🎉 Every target is planned.</p>}
      <ul className="space-y-3">
        {short.map((s) => {
          const area = areas.find((a) => a.id === s.areaId);
          const choices = dayChoices(data, s.areaId, now);
          return (
            <li key={s.areaId} className="rounded-2xl border border-line p-3">
              <p className="text-[15px] font-semibold">
                {area?.emoji} {shortLine(s)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {choices.map((c) => (
                  <button
                    key={c.date}
                    className={`${btn.soft} min-h-10`}
                    onClick={() => {
                      const undo = actions.addCatchUp({ areaId: s.areaId, date: c.date, minutes: area?.target?.minutes ?? 30 }, now);
                      ctx.notify(`Added ${s.name} for ${c.label}`, undo ?? undefined);
                    }}
                  >
                    Add {c.label}
                  </button>
                ))}
                <button
                  className={`${btn.ghost} min-h-10`}
                  onClick={() => {
                    const cur = data.settings.shortDismissed?.week === week ? data.settings.shortDismissed.areas : [];
                    actions.settings({ shortDismissed: { week, areas: [...cur, s.areaId] } });
                  }}
                >
                  Not this week
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
