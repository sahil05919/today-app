"use client";
import { useMemo } from "react";
import { eveningLine } from "@/lib/cheer";
import { actions } from "@/lib/store";
import { buildTimeline, type TLItem } from "@/lib/timeline";
import type { RescheduleChoice, RescheduleTarget } from "@/lib/reschedule";
import type { AppData, ISODate } from "@/lib/types";
import { completeItem, openCount } from "./itemActions";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

interface Row {
  key: string;
  title: string;
  carried?: boolean;
  /** Present for a timeline item; absent for a task that is waiting for room. */
  item?: TLItem;
  taskId?: string;
}

const clean = (t: string) => t.replace(/ · session \d+$| session \d+$/, "");

/**
 * The end of the day: "Tick or move what's left." A quick list of what is still open, with Done / Tomorrow / Not sure on each
 * row (Not sure lets the planner pick the day). Nothing is forced: anything left simply stays on tomorrow's list.
 */
export function EveningWrap({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const tl = useMemo(() => buildTimeline(data, ctx.today, new Date()), [data, ctx.today]);
  const rows: Row[] = [
    ...tl.items
      .filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay && !x.fixed && x.kind !== "event" && x.kind !== "calendar")
      .map((x) => ({ key: x.key, title: clean(x.title), carried: x.carried, item: x, taskId: x.taskId })),
    ...tl.overflow.map((o) => ({ key: o.task.id, title: o.task.title, carried: o.carried, taskId: o.task.id })),
  ];

  const close = () => {
    actions.settings({ wrapDate: ctx.today });
    onClose();
  };
  const targetOf = (r: Row, date: ISODate): RescheduleTarget => (r.taskId ? { kind: "task", taskId: r.taskId } : { kind: "item", item: r.item!, date });
  const move = (r: Row, choice: RescheduleChoice) => {
    const res = actions.reschedule(targetOf(r, ctx.today), choice);
    if (res) ctx.notify(res.message, res.undo);
    else ctx.notify("That one can't move right now");
  };
  const done = (r: Row) => {
    if (r.item) completeItem(r.item, ctx, ctx.today, openCount(tl.items, r.item.key));
    else if (r.taskId) {
      actions.toggleDone(r.taskId);
      ctx.notify("Done. One less thing.", () => actions.toggleDone(r.taskId!));
    }
  };

  const small = "min-h-10 rounded-xl px-3 text-sm font-semibold transition active:scale-[0.98]";
  return (
    <Sheet title="Tick or move what's left" onClose={close}>
      <div className="py-1 text-center">
        <div className="text-3xl" aria-hidden="true">
          🌙
        </div>
        <p className="mt-2 text-[17px] font-semibold leading-snug">{eveningLine(ctx.profile.name, tl.summary.done, tl.summary.total)}</p>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-bg px-3">
          {rows.map((r) => (
            <li key={r.key} className="py-2.5">
              <p className="flex items-center gap-2 text-[15px] font-medium">
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                {r.carried && <Chip tone="warn">carried over</Chip>}
              </p>
              <div className="mt-1.5 flex gap-2">
                <button onClick={() => done(r)} className={`${small} bg-accent text-accent-ink`}>
                  ✓ Done
                </button>
                <button onClick={() => move(r, { kind: "tomorrow" })} className={`${small} border border-line bg-surface text-ink`}>
                  Tomorrow
                </button>
                <button onClick={() => move(r, { kind: "not-sure" })} className={`${small} text-muted`}>
                  Not sure
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-center text-sm text-muted">Nothing left over. You're free. 🎉</p>
      )}

      <button className={`${btn.primary} mt-4 min-h-12 w-full`} onClick={close}>
        {rows.length ? "Leave the rest" : "Good night"}
      </button>
      {rows.length > 0 && <p className="mt-2 text-center text-xs text-muted">What's left comes first tomorrow. Nothing to do now.</p>}
    </Sheet>
  );
}
