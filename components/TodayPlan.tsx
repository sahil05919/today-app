"use client";
import { useMemo, useState } from "react";
import { billsOnDay } from "@/lib/bills";
import { fromISO } from "@/lib/dates";
import { eventSpan, eventsOn } from "@/lib/fixed";
import { toHHMM, withDefaults } from "@/lib/profile";
import { planSessions, plannedForDay, type PlannedSession } from "@/lib/schedule";
import { choreKey, entryFor, sessionKey, weekProgress, type ProgressRow } from "@/lib/sessions";
import { actions } from "@/lib/store";
import type { AppData, Bill, FixedEvent, RhythmItem } from "@/lib/types";
import { CheckIcon } from "./icons";
import { btn, field, Sheet, type Panel, type ViewCtx } from "./ui";

type BillRow = { bill: Bill; due: string; key: string; label: string; offset: number };
type Row =
  | { kind: "session"; time: number; s: PlannedSession; done: boolean; skipped: boolean }
  | { kind: "chore"; time: number; r: RhythmItem; done: boolean; skipped: boolean }
  | { kind: "event"; time: number; e: FixedEvent; done: false; skipped: false }
  | { kind: "bill"; time: number; b: BillRow; done: boolean; skipped: boolean };

const hm = (min: number) => toHHMM(min);
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** The day at a glance: events, sessions, bills and check-ins in order. Tap the circle to count it. */
export function TodayPlan({ data, ctx, onProgress, openPanel }: { data: AppData; ctx: ViewCtx; onProgress: () => void; openPanel?: (p: Panel) => void }) {
  const [open, setOpen] = useState<Row | null>(null);
  const p = useMemo(() => withDefaults(data.profile), [data.profile]);
  const dow = fromISO(ctx.today).getDay();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const e of eventsOn(data, ctx.today)) out.push({ kind: "event", time: e.start ? minOf(e.start) : -1, e, done: false, skipped: false });
    for (const s of plannedForDay(data, ctx.today)) {
      out.push({ kind: "session", time: s.start, s, done: s.done, skipped: entryFor(data.log, s.key)?.status === "skip" });
    }
    for (const r of p.rhythm) {
      if (!r.enabled || r.kind !== "chore" || !r.days.includes(dow)) continue;
      const e = entryFor(data.log, choreKey(r.id, ctx.today));
      out.push({ kind: "chore", time: minOf(r.time), r, done: e?.status === "done", skipped: e?.status === "skip" });
    }
    // Bills and chores that are due, or have a reminder, today. Once done they stay as a ticked row.
    for (const r of billsOnDay(data, ctx.today)) {
      out.push({ kind: "bill", time: minOf(r.bill.time), b: { bill: r.bill, due: r.due, key: r.key, label: r.label, offset: r.offset }, done: false, skipped: false });
    }
    for (const b of data.bills ?? []) {
      if (!b.enabled || b.autopay || b.lastDone !== ctx.today) continue;
      if (out.some((x) => x.kind === "bill" && x.b.bill.id === b.id)) continue;
      out.push({ kind: "bill", time: minOf(b.time), b: { bill: b, due: ctx.today, key: `bill:${b.id}:${ctx.today}`, label: "Done", offset: 0 }, done: true, skipped: false });
    }
    return out.sort((a, b) => a.time - b.time);
  }, [data, p.rhythm, ctx.today, dow]);

  const progress = useMemo(() => weekProgress(data, ctx.today), [data, ctx.today]);
  if (!progress.length && !rows.length) return null;

  const toggle = (row: Row) => {
    if (row.kind === "session") {
      const log = actions.toggleSession(row.s.areaId, ctx.today, "manual");
      ctx.notify(log ? `${row.s.title} counted` : `${row.s.title} un-counted`, () => actions.toggleSession(row.s.areaId, ctx.today, "manual"));
    } else if (row.kind === "chore") {
      actions.setEntry(choreKey(row.r.id, ctx.today), row.done ? null : "done");
    } else if (row.kind === "bill") {
      if (!row.done) {
        actions.completeBill(row.b.bill.id, row.b.due);
        ctx.notify(`${row.b.bill.name}: done`);
      }
    }
  };

  const isOffice = p.officeDays.includes(dow);
  const work = p.workDays.includes(dow);

  const titleOf = (row: Row) =>
    row.kind === "session" ? row.s.title : row.kind === "chore" ? row.r.label : row.kind === "event" ? row.e.title : row.b.bill.name;
  const subOf = (row: Row) => {
    if (row.kind === "session") return `${hm(row.s.start)} · ${row.s.minutes} min`;
    if (row.kind === "chore") return hm(row.time);
    if (row.kind === "bill") return `${row.b.label} · ${hm(row.time)}`;
    const [s, e] = eventSpan(row.e);
    return row.e.start ? `${hm(s)}–${hm(e)}` : "All day";
  };
  const keyOf = (row: Row) => (row.kind === "session" ? row.s.key : row.kind === "chore" ? `c:${row.r.id}` : row.kind === "event" ? `e:${row.e.id}` : `b:${row.b.key}:${row.b.offset}`);

  return (
    <section aria-label="Today's plan" className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Today's plan</h2>
        <span className="text-xs text-muted">{isOffice ? "🏢 Office day" : work ? `Work ${p.workStart}–${p.workEnd}` : "Day off"}</span>
      </div>

      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const title = titleOf(row);
            return (
              <li key={keyOf(row)} className="flex items-center">
                {row.kind === "event" ? (
                  <span className="flex h-12 w-11 shrink-0 items-center justify-center text-lg" aria-hidden="true">
                    📌
                  </span>
                ) : (
                  <button
                    onClick={() => toggle(row)}
                    aria-label={row.done ? `Un-count ${title}` : `Count ${title} as done`}
                    className="flex h-12 w-11 shrink-0 items-center justify-center"
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                        row.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"
                      }`}
                    >
                      <CheckIcon width={14} height={14} />
                    </span>
                  </button>
                )}
                <button onClick={() => setOpen(row)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-1 text-left">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[15px] font-medium ${row.done || row.skipped ? "text-muted" : ""} ${row.done ? "line-through" : ""}`}>
                      {row.kind === "session" && <span className="mr-1">{p.areas.find((a) => a.id === row.s.areaId)?.emoji}</span>}
                      {title}
                    </span>
                    <span className="block text-xs text-muted">{row.skipped ? "Skipped today" : subOf(row)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-0.5 py-2 text-sm text-muted">Nothing planned for today. A light day is fine.</p>
      )}

      {progress.length > 0 && (
        <button onClick={onProgress} className="mt-2 grid w-full grid-cols-5 gap-2 border-t border-line pt-3 text-left" aria-label="Weekly progress">
          {progress.slice(0, 5).map((r) => (
            <ProgressMini key={r.area.id} r={r} />
          ))}
        </button>
      )}

      {open && open.kind === "event" && <EventSheet event={open.e} data={data} ctx={ctx} onClose={() => setOpen(null)} />}
      {open && open.kind !== "event" && <SessionSheet row={open} ctx={ctx} onClose={() => setOpen(null)} openPanel={openPanel} />}
    </section>
  );
}

function ProgressMini({ r }: { r: ProgressRow }) {
  const pct = Math.min(100, Math.round((r.done / r.target) * 100));
  return (
    <span className="block text-center">
      <span className="block text-base leading-none" aria-hidden="true">
        {r.area.emoji}
      </span>
      <span className="mt-1 block text-[11px] font-semibold tabular-nums">
        {r.done}/{r.target}
      </span>
      <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-line">
        <span className={`block h-full rounded-full ${r.done >= r.target ? "bg-accent" : "bg-accent/60"}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function SessionSheet({ row, ctx, onClose, openPanel }: { row: Exclude<Row, { kind: "event" }>; ctx: ViewCtx; onClose: () => void; openPanel?: (p: Panel) => void }) {
  const title = row.kind === "session" ? row.s.title : row.kind === "chore" ? row.r.label : row.b.bill.name;
  const key = row.kind === "session" ? sessionKey(row.s.areaId, ctx.today) : row.kind === "chore" ? choreKey(row.r.id, ctx.today) : row.b.key;
  const { done, skipped } = row;

  const markDone = () => {
    if (row.kind === "session") {
      if (!done) actions.toggleSession(row.s.areaId, ctx.today, "manual");
    } else if (row.kind === "bill") actions.completeBill(row.b.bill.id, row.b.due);
    else actions.setEntry(key, "done");
    ctx.notify(`${title}: done`);
    onClose();
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {row.kind === "session" && (
        <p className="-mt-1 mb-4 text-sm text-muted">
          {hm(row.s.start)}–{hm(row.s.end)} · {row.s.minutes} min
        </p>
      )}
      {row.kind === "bill" && <p className="-mt-1 mb-4 text-sm text-muted">{row.b.label}</p>}
      <div className="space-y-2">
        {row.kind === "bill" && row.b.bill.groceries && openPanel && (
          <button
            className={`${btn.soft} min-h-12 w-full`}
            onClick={() => {
              onClose();
              openPanel("shopping");
            }}
          >
            🛒 Open shopping list
          </button>
        )}
        {done ? (
          row.kind !== "bill" && (
            <button
              className={`${btn.ghost} min-h-12 w-full`}
              onClick={() => {
                if (row.kind === "session") actions.toggleSession(row.s.areaId, ctx.today);
                else actions.setEntry(key, null);
                onClose();
              }}
            >
              Undo, I didn't
            </button>
          )
        ) : (
          <button className={`${btn.primary} min-h-12 w-full`} onClick={markDone}>
            ✓ Done
          </button>
        )}
        {!done && !skipped && (
          <button
            className={`${btn.ghost} min-h-12 w-full`}
            onClick={() => {
              actions.setEntry(key, "skip");
              ctx.notify(`Skipped ${title}`, () => actions.setEntry(key, null));
              onClose();
            }}
          >
            Skip today
          </button>
        )}
        {skipped && (
          <button
            className={`${btn.ghost} min-h-12 w-full`}
            onClick={() => {
              actions.setEntry(key, null);
              onClose();
            }}
          >
            Bring it back
          </button>
        )}
      </div>
      {row.kind === "session" && <p className="mt-3 text-xs text-muted">Skipping doesn't count it. The week re-plans around it.</p>}
    </Sheet>
  );
}

/** Edit or delete a fixed event. Changing it re-plans the week's sessions around the new time. */
function EventSheet({ event, data, ctx, onClose }: { event: FixedEvent; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const areas = withDefaults(data.profile).areas.filter((a) => a.target);
  const set = (patch: Partial<FixedEvent>) => actions.updateEvent(event.id, patch);
  const label = "mb-1 block text-xs font-medium text-muted";
  return (
    <Sheet title="Fixed event" onClose={onClose}>
      <div className="space-y-4">
        <input value={event.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title" className={`${field} text-lg font-semibold`} />
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={label}>Date</span>
            <input type="date" value={event.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={field} />
          </label>
          <label className="flex items-end gap-2 pb-2.5 text-sm">
            <input
              type="checkbox"
              checked={!event.start}
              onChange={(e) => set(e.target.checked ? { start: undefined, end: undefined } : { start: "18:00", end: "20:00" })}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            All day
          </label>
          {event.start && (
            <>
              <label>
                <span className={label}>Starts</span>
                <input type="time" value={event.start} onChange={(e) => e.target.value && set({ start: e.target.value })} className={field} />
              </label>
              <label>
                <span className={label}>Ends</span>
                <input type="time" value={event.end ?? ""} onChange={(e) => set({ end: e.target.value || undefined })} className={field} />
              </label>
            </>
          )}
        </div>
        <label className="block">
          <span className={label}>Counts as a session of</span>
          <select value={event.countsFor ?? ""} onChange={(e) => set({ countsFor: e.target.value || undefined })} className={field}>
            <option value="">Nothing</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">This block never moves. Sessions on that day shift to the next free days, still hitting your weekly targets where they can.</p>
        <button
          className="flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-medium text-warn"
          onClick={() => {
            const copy = event;
            actions.removeEvent(event.id);
            ctx.notify("Event removed", () => actions.restoreEvent(copy));
            onClose();
          }}
        >
          Delete event
        </button>
      </div>
    </Sheet>
  );
}

/** Full weekly progress: per-area targets, minutes, last session and the next one planned. */
export function ProgressSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const rows = weekProgress(data, ctx.today);
  const plan = useMemo(() => planSessions(data, new Date()), [data]);
  return (
    <Sheet title="This week" onClose={onClose}>
      <ul className="space-y-4">
        {rows.map((r) => {
          const pct = Math.min(100, Math.round((r.done / r.target) * 100));
          const next = plan.find((s) => s.areaId === r.area.id && !s.done);
          return (
            <li key={r.area.id}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold">
                  {r.area.emoji} {r.area.name}
                </p>
                <p className="text-sm tabular-nums text-muted">
                  {r.done} of {r.target}
                </p>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {r.minutes ? `${r.minutes} min this week · ` : ""}
                {r.daysSince == null ? "No session yet" : r.daysSince === 0 ? "Last: today" : `Last: ${r.daysSince} day${r.daysSince === 1 ? "" : "s"} ago`}
                {next ? ` · Next: ${next.title.replace(/ session \d+$/, "")} ${next.date === ctx.today ? "today" : fromISO(next.date).toLocaleDateString("en-GB", { weekday: "short" })} ${hm(next.start)}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
