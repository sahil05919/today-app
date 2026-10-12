"use client";
import { useMemo, useState } from "react";
import { previewClear } from "@/lib/clear";
import { hhmm, type ClearParse, type ClearWindow } from "@/lib/clearParse";
import { dayOfMonth, weekdayShort } from "@/lib/dates";
import { buzz } from "@/lib/haptics";
import { actions } from "@/lib/store";
import type { AppData, ISODate } from "@/lib/types";
import { btn, field, Sheet, type ViewCtx } from "./ui";

/** What the capture bar hands over: a parsed window, or "ask me" (with what was understood, to prefill the picker). */
export type ClearFlowState = { windows: ClearWindow[]; label: string } | { picker: true; understood: ClearParse["understood"] };

const when = (date: ISODate, start: number, today: ISODate) => `${date === today ? "today" : `${weekdayShort(date)} ${dayOfMonth(date)}`} ${hhmm(start)}`;

/** "Clear a time range…": a date and a start / end. Also where an unclear command lands, prefilled. */
function RangePicker({ understood, ctx, onPreview, onClose }: { understood: ClearParse["understood"]; ctx: ViewCtx; onPreview: (windows: ClearWindow[], label: string) => void; onClose: () => void }) {
  const now = new Date();
  const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 5) * 5;
  const [date, setDate] = useState<ISODate>(understood.date ?? ctx.today);
  const [start, setStart] = useState(hhmm(understood.start ?? Math.min(nowMin, 22 * 60)));
  const [end, setEnd] = useState(hhmm(understood.end ?? Math.min(nowMin + 120, 22 * 60 + 30)));
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const ok = !!date && !!start && !!end && toMin(end) > toMin(start) && date >= ctx.today;
  return (
    <Sheet title="Clear a time range" onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Day</span>
          <input type="date" value={date} min={ctx.today} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">From</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Until</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
          </label>
        </div>
        <button className={`${btn.primary} min-h-12 w-full`} disabled={!ok} onClick={() => onPreview([{ date, start: toMin(start), end: toMin(end) }], `${date === ctx.today ? "today" : `${weekdayShort(date)} ${dayOfMonth(date)}`} ${start}–${end}`)}>
          See what would move
        </button>
      </div>
    </Sheet>
  );
}

/** Before anything moves: what will move (and where), what is fixed here (Keep or Move), then Confirm / Cancel. */
function ClearPreviewSheet({ windows, label, data, ctx, onClose }: { windows: ClearWindow[]; label: string; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const preview = useMemo(() => previewClear(data, windows, new Date()), [data, windows]);
  const [move, setMove] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setMove((m) => {
      const n = new Set(m);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const nothing = !preview.willMove.length && !preview.fixed.length;
  return (
    <Sheet title={`Clear ${label}`} onClose={onClose}>
      <div className="space-y-4">
        {nothing && <p className="text-sm text-muted">Nothing is planned in that time. It will just be kept free.</p>}

        {preview.willMove.length > 0 && (
          <section aria-label="Will move">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Will move</h3>
            <ul className="space-y-1.5">
              {preview.willMove.map((m) => (
                <li key={m.key} className="rounded-xl bg-bg px-3 py-2 text-sm">
                  <span className="font-medium">
                    {m.emoji ? `${m.emoji} ` : ""}
                    {m.title}
                  </span>
                  <span className="block text-xs text-muted">
                    {when(m.from.date, m.from.start, ctx.today)} → {m.to ? when(m.to.date, m.to.start, ctx.today) : "no room this week (it will show in “This week's targets”)"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {preview.fixed.length > 0 && (
          <section aria-label="Fixed in this window">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Fixed in this window</h3>
            <ul className="space-y-1.5">
              {preview.fixed.map((f) => {
                const moving = move.has(f.key);
                return (
                  <li key={f.key} className="rounded-xl bg-bg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {f.emoji ? `${f.emoji} ` : ""}
                          {f.title}
                        </span>
                        <span className="block text-xs text-muted">
                          {when(f.date, f.start, ctx.today)}–{hhmm(f.end)}
                        </span>
                      </span>
                      {f.action !== "none" && (
                        <div className="flex shrink-0 overflow-hidden rounded-lg border border-line text-xs font-medium" role="group" aria-label={`${f.title}: keep or ${f.action === "hide" ? "hide" : "move"}`}>
                          <button className={`min-h-9 px-3 ${!moving ? "bg-accent text-accent-ink" : ""}`} aria-pressed={!moving} onClick={() => moving && toggle(f.key)}>
                            Keep
                          </button>
                          <button className={`min-h-9 px-3 ${moving ? "bg-accent text-accent-ink" : ""}`} aria-pressed={moving} onClick={() => !moving && toggle(f.key)}>
                            {f.action === "hide" ? "Hide for today" : "Move"}
                          </button>
                        </div>
                      )}
                    </div>
                    {f.note && <p className="mt-1 text-xs text-muted">{f.note}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="flex gap-2">
          <button
            className={`${btn.primary} min-h-12 flex-1`}
            onClick={() => {
              buzz(20);
              const r = actions.clearWindows(windows, label, move);
              ctx.notify(r.message, r.undo);
              onClose();
            }}
          >
            Confirm
          </button>
          <button className={`${btn.ghost} min-h-12 flex-1`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** The whole clear flow: [range picker →] preview → confirm. Rendered by the capture bar. */
export function ClearFlow({ flow, data, ctx, onClose }: { flow: ClearFlowState; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [picked, setPicked] = useState<{ windows: ClearWindow[]; label: string } | null>(null);
  const chosen = "windows" in flow ? flow : picked;
  if (chosen) return <ClearPreviewSheet windows={chosen.windows} label={chosen.label} data={data} ctx={ctx} onClose={onClose} />;
  return (
    <>
      <RangePicker understood={"understood" in flow ? flow.understood : {}} ctx={ctx} onPreview={(windows, label) => setPicked({ windows, label })} onClose={onClose} />
      {picked && <ClearPreviewSheet windows={picked.windows} label={picked.label} data={data} ctx={ctx} onClose={() => setPicked(null)} />}
    </>
  );
}

/** Tapping a "Cleared" block on the timeline: put it back. */
export function ClearedSheet({ id, data, ctx, onClose }: { id: string; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const c = (data.cleared ?? []).find((x) => x.id === id);
  if (!c) return null;
  return (
    <Sheet title="Cleared" onClose={onClose}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        🧹 {c.date === ctx.today ? "Today" : `${weekdayShort(c.date)} ${dayOfMonth(c.date)}`} {hhmm(c.start)}–{hhmm(c.end)} is kept free. Nothing is planned into it.
      </p>
      <button
        className={`${btn.primary} min-h-12 w-full`}
        onClick={() => {
          actions.removeCleared(c.group);
          ctx.notify("Put back. The planner can use that time again");
          onClose();
        }}
      >
        Put it back
      </button>
    </Sheet>
  );
}

