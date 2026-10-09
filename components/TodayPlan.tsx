"use client";
import { useMemo } from "react";
import { fromISO } from "@/lib/dates";
import { toHHMM, withDefaults } from "@/lib/profile";
import { planSessions } from "@/lib/schedule";
import { paceStatus } from "@/lib/pace";
import { countLabel, dots, weeklyPercent } from "@/lib/progress";
import { weekProgress } from "@/lib/sessions";
import { dayWord } from "@/lib/done";
import { actions, useData } from "@/lib/store";
import type { TLItem } from "@/lib/timeline";
import type { AppData, FixedEvent, ISODate } from "@/lib/types";
import { completeItem, skipItem, startItem, undoItem, unskipItem } from "./itemActions";
import { btn, field, Sheet, type Panel, type ViewCtx } from "./ui";

const hm = (min: number) => toHHMM(min);

/**
 * Details and actions for a session, chore or bill on the timeline, on ANY day (Today and the Calendar share it).
 *   today   Start / Done / Snooze / Skip, and "One more" for a session
 *   future  "Done already": you did it early, so it counts now and its slot and reminder go away
 *   past    "Missed": "I did it" is logged on THAT day (a bill: "Paid"), or Skip
 */
export function ItemSheet({
  item,
  date,
  left,
  ctx,
  onClose,
  onSnooze,
  openPanel,
}: {
  item: TLItem;
  date: ISODate;
  /** Other open things today (for the closing line). */
  left: number;
  ctx: ViewCtx;
  onClose: () => void;
  /** Snooze only exists on Today (the Calendar leaves it out). */
  onSnooze?: (it: TLItem) => void;
  openPanel?: (p: Panel) => void;
}) {
  const data = useData();
  const mode: "today" | "future" | "past" = date === ctx.today ? "today" : date > ctx.today ? "future" : "past";
  const bill = item.kind === "bill" ? data?.bills?.find((b) => b.id === item.bill?.id) : undefined;
  const groceries = !!bill?.groceries;
  // Every session logged for this area on this day, each its own numbered session, each removable on its own.
  const logs = item.kind === "session" ? (data?.sessions ?? []).filter((l) => l.areaId === item.areaId && l.date === date).sort((x, y) => x.at - y.at) : [];
  const area = ctx.profile.areas.find((x) => x.id === item.areaId);
  const missed = mode === "past" && !item.done && !item.skipped;
  const day = dayWord(date, ctx.today);
  const sub =
    item.kind === "bill"
      ? mode === "today" || item.done
        ? item.bill?.label
        : mode === "future"
          ? `Due ${day}`
          : `Missed · due ${day}`
      : `${missed ? "Missed · " : mode === "future" ? `${day} · ` : ""}${hm(item.start)}–${hm(item.end)} · ${item.end - item.start} min`;
  const btnClass = (k: keyof typeof btn) => `${btn[k]} min-h-12 w-full`;
  return (
    <Sheet title={item.title} onClose={onClose}>
      <p className={`-mt-1 mb-4 text-sm ${missed ? "font-medium text-warn" : "text-muted"}`}>{sub}</p>
      <div className="space-y-2">
        {groceries && openPanel && (
          <button
            className={btnClass("soft")}
            onClick={() => {
              onClose();
              openPanel("shopping");
            }}
          >
            🛒 Open shopping list
          </button>
        )}

        {item.kind === "session" && logs.length > 0 && (
          <div className="rounded-2xl bg-bg p-3" aria-label="Logged">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{mode === "today" ? "Logged today" : `Logged ${day}`}</p>
            <ul>
              {logs.map((l) => (
                <li key={l.id} className="flex min-h-11 items-center gap-2 text-[15px]">
                  <span className="min-w-0 flex-1 truncate">
                    {area?.emoji} {l.variant ?? area?.name} · session {l.n}
                  </span>
                  <button
                    onClick={() => {
                      actions.removeSession(l.id);
                      ctx.notify(`Session ${l.n} removed`, () => actions.addSession(l.areaId, l.date, l.source));
                    }}
                    className="min-h-11 rounded-full px-3 text-sm font-medium text-muted"
                    aria-label={`Remove session ${l.n}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.done ? (
          <>
            {item.kind === "session" && (
              <button
                className={btnClass("soft")}
                onClick={() => {
                  completeItem(item, ctx, date, left, { extra: true });
                  onClose();
                }}
              >
                ＋ One more
              </button>
            )}
            {item.kind !== "bill" && item.kind !== "session" && (
              <button
                className={btnClass("ghost")}
                onClick={() => {
                  undoItem(item, ctx, date);
                  onClose();
                }}
              >
                Undo, I didn't
              </button>
            )}
          </>
        ) : item.skipped ? (
          <button
            className={btnClass("ghost")}
            onClick={() => {
              unskipItem(item, date);
              onClose();
            }}
          >
            Bring it back
          </button>
        ) : (
          <>
            <button
              className={btnClass("primary")}
              onClick={() => {
                completeItem(item, ctx, date, left);
                onClose();
              }}
            >
              {mode === "future" ? "✓ Done already" : mode === "past" ? (bill?.kind === "bill" ? "✓ Paid" : "✓ I did it") : "✓ Done"}
            </button>
            {mode === "today" ? (
              <div className={`grid gap-2 ${onSnooze ? "grid-cols-3" : "grid-cols-2"}`}>
                <button
                  className={`${btn.soft} min-h-12`}
                  onClick={() => {
                    startItem(item, ctx);
                    onClose();
                  }}
                >
                  ▶ Start
                </button>
                {onSnooze && (
                  <button
                    className={`${btn.ghost} min-h-12`}
                    onClick={() => {
                      onClose();
                      onSnooze(item);
                    }}
                  >
                    Snooze
                  </button>
                )}
                <button
                  className={`${btn.ghost} min-h-12`}
                  onClick={() => {
                    skipItem(item, ctx, date);
                    onClose();
                  }}
                >
                  Skip
                </button>
              </div>
            ) : (
              <button
                className={btnClass("ghost")}
                onClick={() => {
                  skipItem(item, ctx, date);
                  onClose();
                }}
              >
                Skip
              </button>
            )}
          </>
        )}
      </div>
      {mode === "future" && !item.done && !item.skipped && (
        <p className="mt-3 text-xs text-muted">
          {item.kind === "session"
            ? "Counts today, and this slot and its reminder go away."
            : item.kind === "bill"
              ? "Marks this one done now. No reminder for it, and a repeating one restarts from today."
              : "Marks this one done now. No reminder for it."}
        </p>
      )}
      {missed && <p className="mt-3 text-xs text-muted">{item.kind === "session" ? `Logged on ${day}, so that day and the week count it.` : "Marks it done for that day."}</p>}
      {item.kind === "session" && mode === "today" && !item.done && <p className="mt-3 text-xs text-muted">Skipping doesn't count it. The week re-plans around it.</p>}
    </Sheet>
  );
}

/** Edit or delete a fixed event. Changing it re-plans the week's sessions around the new time. */
export function EventSheet({ event, data, ctx, onClose }: { event: FixedEvent; data: AppData; ctx: ViewCtx; onClose: () => void }) {
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
export function ProgressSheet({ data, ctx, onClose, onReview }: { data: AppData; ctx: ViewCtx; onClose: () => void; onReview?: () => void }) {
  const pace = useMemo(() => paceStatus(data, ctx.today), [data, ctx.today]);
  const total = useMemo(() => weeklyPercent(data, ctx.today), [data, ctx.today]);
  const rows = weekProgress(data, ctx.today);
  const plan = useMemo(() => planSessions(data, new Date()), [data]);
  return (
    <Sheet title="This week" onClose={onClose}>
      <p className="-mt-1 mb-4 text-[15px]">
        <span className="text-2xl font-semibold tabular-nums">{total.pct}%</span>
        <span className={`ml-2 font-medium ${pace.status === "behind" ? "text-warn" : "text-accent"}`}>{pace.label}</span>
      </p>
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
                  <span className="mr-2 tracking-[0.18em]" aria-hidden="true">
                    {Array.from({ length: dots(r).total }, (_, i) => (
                      <span key={i} className={i < dots(r).filled ? "text-accent" : "text-line"}>
                        {i < dots(r).filled ? "●" : "○"}
                      </span>
                    ))}
                  </span>
                  {r.finished ? countLabel(r) : `${r.done} of ${r.target}`}
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
      {onReview && (
        <button className={`${btn.soft} mt-5 min-h-12 w-full`} onClick={onReview}>
          🗓️ Weekly review
        </button>
      )}
    </Sheet>
  );
}
