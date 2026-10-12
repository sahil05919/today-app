"use client";
import { useMemo, useState } from "react";
import { addDays } from "@/lib/dates";
import { buzz } from "@/lib/haptics";
import { rescheduleOptions, type RescheduleChoice, type RescheduleTarget } from "@/lib/reschedule";
import { actions, useData } from "@/lib/store";
import { btn, field, Sheet, type ViewCtx } from "./ui";

/**
 * Reschedule (it replaces Snooze): +1 hour, this evening (the first free slot from 18:00, gone after about 21:00),
 * tomorrow morning (the first free slot in the 8–9 window), a date and time you pick, or "Not sure": the planner finds
 * the next day with room (tomorrow, else the next free day, up to a week) and keeps weekly targets and light weekends.
 */
export function RescheduleSheet({ target, ctx, onClose }: { target: RescheduleTarget; ctx: ViewCtx; onClose: () => void }) {
  const data = useData();
  const now = useMemo(() => new Date(), []);
  const [date, setDate] = useState(addDays(ctx.today, 1));
  const [time, setTime] = useState("18:30");
  const info = useMemo(() => (data ? rescheduleOptions(data, target, now) : null), [data, target, now]);
  if (!info) return null;

  const finish = (r: { message: string; undo: () => void } | null) => {
    if (!r) {
      ctx.notify("There was no room for that. Try another option.");
      return;
    }
    buzz(15);
    ctx.notify(r.message, r.undo);
    onClose();
  };
  const choose = (choice: RescheduleChoice) => finish(actions.reschedule(target, choice, new Date()));

  return (
    <Sheet title="Reschedule" onClose={onClose}>
      <p className="-mt-1 mb-3 truncate text-sm text-muted">{info.subject.title}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {info.options.map((o) => (
          <button
            key={o.kind}
            onClick={() => choose({ kind: o.kind } as RescheduleChoice)}
            disabled={!o.dest}
            className="flex min-h-16 flex-col items-start justify-center rounded-2xl border border-line bg-bg px-4 py-3 text-left transition active:scale-[0.98] disabled:opacity-40"
          >
            <span className="text-[15px] font-semibold">{o.label}</span>
            <span className="text-xs text-muted">{o.kind === "not-sure" ? (o.sub ? `Planner picks: ${o.sub}` : "The planner picks") : o.sub}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-line p-3">
        <p className="mb-2 text-sm font-semibold">Pick date &amp; time</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={date} min={ctx.today} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Date" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} aria-label="Time" />
        </div>
        <button className={`${btn.primary} mt-2.5 min-h-12 w-full`} disabled={!date || !time} onClick={() => finish(actions.rescheduleTo(target, { date, time }, new Date()))}>
          Set it
        </button>
        <p className="mt-2 text-xs text-muted">A fixed time, with a reminder.</p>
      </div>
    </Sheet>
  );
}
