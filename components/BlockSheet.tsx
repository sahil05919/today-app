"use client";
import { useState } from "react";
import { fromISO, weekdayShort } from "@/lib/dates";
import { buzz } from "@/lib/haptics";
import { toHHMM, toMin } from "@/lib/profile";
import type { BlockId } from "@/lib/busy";
import { BLOCK_TITLE, blockDone, blockSpan, type Scope } from "@/lib/ripple";
import { actions, useData } from "@/lib/store";
import type { ISODate } from "@/lib/types";
import { CheckIcon } from "./icons";
import { btn, field, Sheet, type ViewCtx } from "./ui";

const EMOJI: Record<BlockId, string> = { work: "💼", "commute-to": "🚌", "commute-from": "🚌", lunch: "🍽️", tea: "🍵" };

/**
 * A routine block of the day (work hours, lunch, commute, the tea break): change its start or length, say you are running
 * late (+15 / +30 / +60), tick it, or skip it today. "Just today" changes one day; "Every day" changes your daily rhythm.
 * When a block runs longer, flexible things after it move later and fixed ones (events, timed tasks, bills) stay put;
 * what no longer fits before ~22:30 goes to the next day with room, and a note says what moved.
 */
export function BlockSheet({ id, date, ctx, onClose }: { id: BlockId; date: ISODate; ctx: ViewCtx; onClose: () => void }) {
  const data = useData();
  const span = data ? blockSpan(data, id, date) : null;
  const [scope, setScope] = useState<Scope>("today");
  const [start, setStart] = useState<string | null>(null);
  const [min, setMin] = useState<string | null>(null);
  if (!data || !span) {
    return (
      <Sheet title={BLOCK_TITLE[id]} onClose={onClose}>
        <p className="text-sm text-muted">This is not on the plan for that day.</p>
        {data?.blocks?.[`${id}@${date}`]?.skip && (
          <button
            className={`${btn.primary} mt-3 min-h-12 w-full`}
            onClick={() => {
              actions.unskipBlock(id, date);
              onClose();
            }}
          >
            Bring it back
          </button>
        )}
      </Sheet>
    );
  }
  const cur = { start: toHHMM(span[0]), min: span[1] - span[0] };
  const done = blockDone(data, id, date);
  const dirty = (start !== null && start !== cur.start) || (min !== null && Number(min) !== cur.min);
  const day = date === ctx.today ? "today" : `${weekdayShort(date)} ${fromISO(date).getDate()}`;

  const finish = (r: { note: string | null; undo: () => void }, fallback: string) => {
    buzz(15);
    ctx.notify(r.note ?? fallback, r.undo);
  };
  const save = (edit: { start?: number; min?: number }) => finish(actions.setBlock(id, date, edit, scope), `${BLOCK_TITLE[id]} updated`);

  return (
    <Sheet title={BLOCK_TITLE[id]} onClose={onClose}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        {EMOJI[id]} {cur.start}–{toHHMM(span[1])} · {cur.min} min · {day}
      </p>

      <div className="space-y-4">
        <button
          className={`${done ? btn.ghost : btn.primary} flex min-h-12 w-full items-center justify-center gap-1.5`}
          onClick={() => {
            actions.tickBlock(id, date, !done);
            buzz(20);
            ctx.notify(done ? "Back on the list" : `${BLOCK_TITLE[id]} done`);
            onClose();
          }}
        >
          <CheckIcon width={16} height={16} /> {done ? "Not done after all" : "Done"}
        </button>

        <section aria-label="Running late">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Running late</p>
          <div className="grid grid-cols-3 gap-2">
            {[15, 30, 60].map((m) => (
              <button
                key={m}
                className={`${btn.soft} min-h-12`}
                onClick={() => {
                  save({ min: cur.min + m });
                  onClose();
                }}
              >
                +{m} min
              </button>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1 block text-xs font-medium text-muted">Starts</span>
            <input type="time" value={start ?? cur.start} onChange={(e) => e.target.value && setStart(e.target.value)} className={field} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-muted">Minutes</span>
            <input type="number" min={0} max={600} inputMode="numeric" value={min ?? cur.min} onChange={(e) => setMin(e.target.value)} className={field} />
          </label>
        </div>

        <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="radiogroup" aria-label="Apply to">
          {(
            [
              ["today", "Just today"],
              ["every", "Every day"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={scope === k} onClick={() => setScope(k)} className={`min-h-11 flex-1 rounded-lg ${scope === k ? "bg-surface shadow-sm" : "text-muted"}`}>
              {l}
            </button>
          ))}
        </div>
        {scope === "every" && (id === "commute-to" || id === "commute-from") && <p className="-mt-2 text-xs text-muted">Every day changes how long it takes. The start follows your work hours.</p>}

        {dirty && (
          <button
            className={`${btn.primary} min-h-12 w-full`}
            onClick={() => {
              save({ start: toMin(start ?? cur.start), min: Math.max(0, Math.round(Number(min ?? cur.min)) || 0) });
              onClose();
            }}
          >
            Save changes
          </button>
        )}

        <button
          className={`${btn.ghost} min-h-12 w-full`}
          onClick={() => {
            finish(actions.skipBlock(id, date), `${BLOCK_TITLE[id]} skipped today`);
            onClose();
          }}
        >
          Skip today
        </button>
        <p className="text-xs text-muted">Things you booked (events, anything with its own time, bills) never move. The rest shifts around this.</p>
      </div>
    </Sheet>
  );
}
