"use client";
import { useMemo } from "react";
import { catchUpPlan, moveWhen, type PileUp } from "@/lib/pileup";
import { actions, getData } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

/**
 * The morning check-in when the week is piling up: says so plainly, and offers a catch-up plan that you accept with one tap.
 * The plan only uses days that really have room (it's judged by the same timeline you see), so it's one you can do.
 */
export function CatchUpCard({ data, pile, ctx }: { data: AppData; pile: PileUp; ctx: ViewCtx }) {
  const plan = useMemo(() => catchUpPlan(data, new Date()), [data]);
  const groups = useMemo(() => {
    const by = new Map<string, number>();
    for (const m of plan.moves) by.set(moveWhen(m.to, ctx.today), (by.get(moveWhen(m.to, ctx.today)) ?? 0) + 1);
    return [...by.entries()];
  }, [plan, ctx.today]);

  const accept = () => {
    const prev = getData();
    if (plan.moves.length) actions.moveTasks(plan.moves.map((m) => ({ taskId: m.taskId, to: m.to })));
    actions.settings({ catchUpDate: ctx.today });
    ctx.notify(plan.moves.length ? "Catch-up plan set. One step at a time." : "Noted. Nothing needed moving.", () => actions.replaceAll(prev));
  };

  return (
    <section className="rounded-2xl bg-warn-soft p-4" aria-label="Catch-up plan">
      <p className="text-[15px] font-semibold text-ink">{pile.message}</p>
      {plan.moves.length > 0 ? (
        <p className="mt-1 text-sm text-ink/80">
          Catch-up plan: {groups.map(([when, n]) => `${n} ${when}`).join(", ")}
          {plan.stuck.length ? `, ${plan.stuck.length} need a decision` : ""}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink/80">{plan.stuck.length ? "There isn't room for all of it this week, so a few need a decision." : "Let's pick the sessions that matter most."}</p>
      )}
      {plan.notes.length > 0 && <p className="mt-1 text-sm text-ink/80">{plan.notes[0]}</p>}
      <div className="mt-3 flex gap-2">
        <button className={`${btn.primary} min-h-11 flex-1`} onClick={accept}>
          Accept plan
        </button>
        <button className={`${btn.ghost} min-h-11`} onClick={() => actions.settings({ catchUpDate: ctx.today })}>
          Not now
        </button>
      </div>
    </section>
  );
}
