"use client";
import { useMemo } from "react";
import { calmCard, dayDoneState } from "@/lib/lighten";
import { actions } from "@/lib/store";
import type { Timeline } from "@/lib/timeline";
import type { AppData } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

/**
 * The feel-good close. When today's to-do list is finished and 30+ minutes remain before ~22:30:
 * "All done for today 🎉 Your evening is free." with two choices. "Take it easy" turns into a calm card that celebrates what was done.
 */
export function DayDoneCard({ data, tl, ctx, now, onLighten }: { data: AppData; tl: Timeline; ctx: ViewCtx; now: Date; onLighten: () => void }) {
  const minute = Math.floor(now.getTime() / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => dayDoneState(data, new Date(minute * 60_000), tl), [data, tl, minute]);
  const calm = data.settings.calmDate === ctx.today;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const card = useMemo(() => (calm && state.done ? calmCard(data, new Date(minute * 60_000)) : null), [calm, state.done, data, minute]);

  if (card) {
    return (
      <section className="anim-fade rounded-3xl bg-accent-soft p-4" aria-label="Calm evening">
        <p className="text-[19px] font-semibold leading-snug">{card.title}</p>
        <p className="mt-1 text-[15px]">{card.line}</p>
        <p className="mt-2 text-sm text-muted">Maybe: {card.suggestion}</p>
        <button className={`${btn.ghost} mt-3 min-h-10`} onClick={onLighten}>
          Actually, lighten my week
        </button>
      </section>
    );
  }
  if (!state.offer || calm) return null;
  return (
    <section className="anim-fade rounded-3xl bg-accent-soft p-4" aria-label="All done for today">
      <p className="text-[19px] font-semibold leading-snug">All done for today 🎉</p>
      <p className="mt-1 text-[15px]">Your evening is free. Pull something forward to lighten the week, or take it easy?</p>
      <div className="mt-3 flex gap-2">
        <button className={`${btn.primary} min-h-11 flex-1`} onClick={onLighten}>
          Lighten my week
        </button>
        <button className={`${btn.ghost} min-h-11 flex-1`} onClick={() => actions.settings({ calmDate: ctx.today })}>
          Take it easy
        </button>
      </div>
    </section>
  );
}
