"use client";
import { useMemo, useState } from "react";
import { applyAdjust, planAdjust, type Energy } from "@/lib/adjust";
import { formatMinutes } from "@/lib/dates";
import { MAX_OFF_DAYS, OFF_LIMIT_MESSAGE, isOffDay, offDaysLeft } from "@/lib/offday";
import { actions, getData } from "@/lib/store";
import type { AppData } from "@/lib/types";
import type { TLItem } from "@/lib/timeline";
import { btn, Sheet, type ViewCtx } from "./ui";
import { entryKeyOf } from "./itemActions";

const TIMES: Array<[number, string]> = [
  [30, "30 min"],
  [60, "1 hour"],
  [120, "2 hours"],
  [180, "3 hours"],
  [600, "All day"],
];
const ENERGY: Array<[Energy, string, string]> = [
  ["low", "😴 Low", "Short, gentle things"],
  ["ok", "🙂 Okay", "A normal mix"],
  ["high", "⚡ High", "Make the most of it"],
];

const label = (it: TLItem) => it.title.replace(/ · session \d+$| session \d+$/, "");

/**
 * Adjust my day: how much time, how much energy → today is rebuilt. One button instead of Rescue, Plan and Pick 3.
 * Booked things stay; the rest is chosen to fit, and what doesn't fit moves off today (tasks to tomorrow).
 */
export function AdjustSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [minutes, setMinutes] = useState(120);
  const [energy, setEnergy] = useState<Energy>("ok");
  const plan = useMemo(() => planAdjust(data, new Date(), { minutes, energy }), [data, minutes, energy]);
  const off = isOffDay(data, ctx.today);
  const left = offDaysLeft(data, ctx.today);

  const apply = () => {
    const prev = getData();
    applyAdjust(
      plan,
      {
        moveTasks: actions.moveTasks,
        parkTasks: actions.parkTasks,
        skip: (it) => {
          const key = entryKeyOf(it, ctx.today);
          if (key) actions.setEntry(key, "skip");
        },
      },
      data,
      new Date(),
    );
    ctx.notify(plan.defer.length ? `Day rebuilt. ${plan.defer.length} moved off today.` : "Day rebuilt. You've got room for everything.", () => actions.replaceAll(prev));
    onClose();
  };

  const takeOff = () => {
    if (actions.takeOffDay(ctx.today)) ctx.notify("Off day. Today is lighter, and the rest moves later in the week.", () => actions.cancelOffDay(ctx.today));
    onClose();
  };

  return (
    <Sheet title="Adjust my day" onClose={onClose}>
      <p className="-mt-1 mb-4 text-sm text-muted">Tell me what today really has room for, and I'll rebuild it around that.</p>

      <h3 className="mb-2 text-sm font-semibold">How much time do you have?</h3>
      <div className="flex flex-wrap gap-1.5">
        {TIMES.map(([m, l]) => (
          <button key={m} onClick={() => setMinutes(m)} aria-pressed={minutes === m} className={`min-h-11 rounded-full border px-4 text-sm font-medium ${minutes === m ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg"}`}>
            {l}
          </button>
        ))}
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold">And your energy?</h3>
      <div className="grid grid-cols-3 gap-2">
        {ENERGY.map(([e, l, sub]) => (
          <button key={e} onClick={() => setEnergy(e)} aria-pressed={energy === e} className={`flex min-h-16 flex-col items-center justify-center rounded-2xl border px-2 py-2 ${energy === e ? "border-accent bg-accent-soft" : "border-line bg-bg"}`}>
            <span className="text-[15px] font-semibold">{l}</span>
            <span className="text-center text-[11px] leading-tight text-muted">{sub}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl bg-bg p-3.5">
        <p className="text-sm font-semibold">
          Today would be · {formatMinutes(plan.used)}
          {minutes < 600 ? ` of ${formatMinutes(minutes)}` : ""}
        </p>
        {plan.booked.length + plan.keep.length ? (
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {plan.booked.map((it) => (
              <li key={it.key} className="truncate">
                📌 {label(it)} <span className="text-muted">· booked</span>
              </li>
            ))}
            {plan.keep.map((it) => (
              <li key={it.key} className="truncate">
                {it.emoji ?? "•"} {label(it)}
                {it.carried ? <span className="text-warn"> · carried over</span> : null}
                <span className="text-muted"> · {formatMinutes(Math.max(5, it.end - it.start))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">Nothing to do. Enjoy it.</p>
        )}
        {plan.defer.length > 0 && (
          <>
            <p className="mt-3 text-sm font-semibold text-muted">Moving off today</p>
            <ul className="mt-1 space-y-0.5 text-sm text-muted">
              {plan.defer.map(({ item, to }) => (
                <li key={item.key} className="truncate">
                  {label(item)} → {to === "tomorrow" ? "tomorrow" : "not today"}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <button className={`${btn.primary} mt-4 min-h-12 w-full`} onClick={apply}>
        Rebuild my day
      </button>

      <div className="mt-4 border-t border-line pt-3 text-center">
        {off ? (
          <button
            className={btn.link}
            onClick={() => {
              actions.cancelOffDay(ctx.today);
              onClose();
            }}
          >
            Actually, I'll do today
          </button>
        ) : (
          <>
            <button className="min-h-11 px-3 text-sm font-medium text-muted disabled:opacity-45" disabled={left === 0} onClick={takeOff}>
              🌿 Take an off day instead
            </button>
            <p className="text-xs text-muted">{left === 0 ? OFF_LIMIT_MESSAGE : `Off days left this week: ${left} of ${MAX_OFF_DAYS}`}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
