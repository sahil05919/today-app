"use client";
import { useMemo } from "react";
import { eveningLine } from "@/lib/cheer";
import { actions } from "@/lib/store";
import { buildTimeline } from "@/lib/timeline";
import type { AppData } from "@/lib/types";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

/**
 * The end of the day, with nothing to manage. "Wrap up" is automatic now: what's unfinished simply carries over and comes
 * first tomorrow. This opens from the evening notification and just says how the day went.
 */
export function EveningWrap({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const tl = useMemo(() => buildTimeline(data, ctx.today, new Date()), [data, ctx.today]);
  const pending = [
    ...tl.items.filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay && x.kind !== "event" && x.kind !== "calendar" && x.kind !== "bill"),
    ...tl.overflow.map((o) => ({ key: o.task.id, title: o.task.title, carried: o.carried })),
  ];

  const close = () => {
    actions.settings({ wrapDate: ctx.today });
    onClose();
  };

  return (
    <Sheet title="Today" onClose={close}>
      <div className="py-2 text-center">
        <div className="text-4xl" aria-hidden="true">
          🌙
        </div>
        <p className="mt-3 text-lg font-semibold leading-snug">{eveningLine(ctx.profile.name, tl.summary.done, tl.summary.total)}</p>
      </div>

      {pending.length > 0 ? (
        <div className="mt-3 rounded-2xl bg-bg p-3.5">
          <p className="text-sm font-semibold">Carries over to tomorrow</p>
          <p className="mt-0.5 text-xs text-muted">Nothing to do now. These come first tomorrow.</p>
          <ul className="mt-2 space-y-1 text-[15px]">
            {pending.slice(0, 8).map((x) => (
              <li key={x.key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{x.title.replace(/ · session \d+$| session \d+$/, "")}</span>
                {"carried" in x && x.carried ? <Chip tone="warn">carried over</Chip> : null}
              </li>
            ))}
            {pending.length > 8 && <li className="text-sm text-muted">…and {pending.length - 8} more</li>}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-center text-sm text-muted">Nothing left over. You're free.</p>
      )}

      <button className={`${btn.primary} mt-4 min-h-12 w-full`} onClick={close}>
        Good night
      </button>
    </Sheet>
  );
}
