"use client";
import { useState } from "react";
import { toHHMM } from "@/lib/profile";
import type { Timeline as TL, TLItem } from "@/lib/timeline";
import type { AppData, Goal } from "@/lib/types";
import { CheckIcon } from "./icons";
import { completeItem, entryKeyOf, openCount, startItem, undoItem } from "./itemActions";
import { Chip, type ViewCtx } from "./ui";

/** "in 25 min", "in 2 h" */
function inMinutes(m: number): string {
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `in ${h} h ${m % 60} min` : `in ${h} h`;
}

const range = (it: TLItem) => (it.allDay ? "All day" : it.end > it.start ? `${toHHMM(it.start)}–${toHHMM(it.end)}` : toHHMM(it.start));
const minutesOf = (it: TLItem) => it.end - it.start;

/** The single next thing, with the three buttons that matter: Start, Done, Snooze. Your top must-have sits right under it. */
export function NextUpCard({
  tl,
  item,
  data,
  ctx,
  nowMin,
  goal,
  onOpen,
  onSnooze,
  onGoals,
}: {
  tl: TL;
  item: TLItem | null;
  data: AppData;
  ctx: ViewCtx;
  nowMin: number;
  goal?: Goal;
  onOpen: (it: TLItem) => void;
  onSnooze: (it: TLItem) => void;
  onGoals: () => void;
}) {
  const timer = data.settings.timer;
  const running = !!item && !!timer && (timer.taskId ? timer.taskId === item.taskId : timer.ref === (entryKeyOf(item, tl.date) ?? item.key));
  const isEvent = !!item && (item.kind === "event" || item.kind === "calendar");
  const left = item ? openCount(tl.items, item.key) : 0;

  let state = "Next up";
  if (item) {
    if (item.start <= nowMin && nowMin < item.end) state = "Now";
    else if (item.end <= nowMin) state = "Still to do";
    else state = `Next up · ${inMinutes(item.start - nowMin)}`;
  }

  return (
    <section aria-label="Next up" className="rounded-3xl bg-accent-soft p-4">
      {item ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">{state}</p>
            {item.carried && <Chip tone="warn">carried over</Chip>}
          </div>
          <button onClick={() => onOpen(item)} className="mt-1 block w-full text-left">
            <span className="block text-[22px] font-semibold leading-tight tracking-tight">
              {item.emoji && <span className="mr-1.5">{item.emoji}</span>}
              {item.title}
            </span>
            <span className="mt-1 block text-sm text-muted">
              {range(item)}
              {!isEvent && minutesOf(item) > 0 ? ` · ${minutesOf(item)} min` : ""}
              {item.partial ? " · first chunk" : ""}
              {item.fromCalendar ? " · from your calendar" : ""}
            </span>
          </button>
          <div className="mt-3.5 flex gap-2">
            {isEvent ? (
              <button onClick={() => onOpen(item)} className="min-h-12 flex-1 rounded-2xl bg-accent px-4 text-[15px] font-semibold text-accent-ink active:scale-[0.98]">
                Open
              </button>
            ) : (
              <>
                <button
                  onClick={() => startItem(item, ctx)}
                  disabled={running}
                  className="min-h-12 flex-1 rounded-2xl bg-accent px-4 text-[15px] font-semibold text-accent-ink transition active:scale-[0.98] disabled:opacity-60"
                >
                  {running ? "Running…" : "▶ Start"}
                </button>
                <button
                  onClick={() => completeItem(item, ctx, tl.date, left)}
                  className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-surface px-4 text-[15px] font-semibold text-ink transition active:scale-[0.98]"
                >
                  <CheckIcon width={16} height={16} /> Done
                </button>
                <button onClick={() => onSnooze(item)} className="min-h-12 rounded-2xl bg-surface px-4 text-[15px] font-medium text-muted transition active:scale-[0.98]">
                  Snooze
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="py-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{tl.summary.total > 0 && tl.summary.done >= tl.summary.total ? "All done" : "Nothing next"}</p>
          <p className="mt-1 text-[19px] font-semibold leading-snug">
            {tl.summary.total > 0 && tl.summary.done >= tl.summary.total
              ? `All done for today. Nice work, ${ctx.profile.name || "friend"}.`
              : "Nothing left on the list. A light day is fine."}
          </p>
        </div>
      )}
      {goal && (
        <button onClick={onGoals} className="mt-3 flex min-h-9 w-full items-center gap-2 border-t border-accent/15 pt-2.5 text-left text-sm">
          <span aria-hidden="true">🎯</span>
          <span className="min-w-0 flex-1 truncate font-medium">{goal.text}</span>
        </button>
      )}
    </section>
  );
}

function Row({ it, ctx, tl, nowMin, onOpen }: { it: TLItem; ctx: ViewCtx; tl: TL; nowMin: number; onOpen: (it: TLItem) => void }) {
  const isEvent = it.kind === "event" || it.kind === "calendar";
  const current = !it.done && it.start <= nowMin && nowMin < it.end && !it.muted;

  if (it.muted) {
    return (
      <li className="flex items-center gap-3 py-1.5 pl-1 text-xs text-muted">
        <span className="w-11 shrink-0 tabular-nums">{toHHMM(it.start)}</span>
        <span className="flex-1">
          {it.emoji} {it.title} · {it.end - it.start} min
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-stretch">
      <span className={`w-11 shrink-0 pt-3.5 text-xs tabular-nums ${current ? "font-semibold text-accent" : "text-muted"}`}>{it.allDay ? "all day" : toHHMM(it.start)}</span>
      {isEvent ? (
        <span className="flex h-12 w-9 shrink-0 items-center justify-center text-base" aria-hidden="true">
          {it.emoji}
        </span>
      ) : (
        <button
          onClick={() => (it.done ? (it.kind === "session" ? onOpen(it) : undoItem(it, ctx, tl.date)) : completeItem(it, ctx, tl.date, openCount(tl.items, it.key)))}
          aria-label={it.done ? (it.kind === "session" ? `${it.title}: see what you logged` : `Mark ${it.title} as not done`) : `Mark ${it.title} as done`}
          className="flex h-12 w-9 shrink-0 items-center justify-center"
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${it.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"}`}>
            <CheckIcon width={14} height={14} />
          </span>
        </button>
      )}
      <button onClick={() => onOpen(it)} className="min-h-12 min-w-0 flex-1 border-b border-line py-2 pl-1 text-left">
        <span className={`block truncate text-[15px] font-medium ${it.done ? "text-muted line-through" : ""}`}>
          {!isEvent && it.emoji && <span className="mr-1">{it.emoji}</span>}
          {it.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>
            {it.allDay ? "All day" : isEvent ? range(it) : `${minutesOf(it)} min`}
            {it.partial ? " · first chunk" : ""}
          </span>
          {it.carried && <Chip tone="warn">carried over</Chip>}
          {it.late && !it.done && <Chip tone="warn">earlier</Chip>}
          {it.fromCalendar && <Chip>calendar</Chip>}
        </span>
      </button>
    </li>
  );
}

/**
 * Today as one list in time order. Done things fold into a single "✓ N done" line so what's left is what you see.
 * Breaks and the commute are shown quietly so you can see the shape of the day.
 */
export function TimelineList({ tl, ctx, nowMin, onOpen, openPanel }: { tl: TL; ctx: ViewCtx; nowMin: number; onOpen: (it: TLItem) => void; openPanel?: (p: "adjust") => void }) {
  const [showDone, setShowDone] = useState(false);
  const done = tl.items.filter((x) => (x.done || x.skipped) && !x.muted);
  const rest = tl.items.filter((x) => !x.done && !x.skipped);
  // Past breaks and commutes are just noise.
  const visible = rest.filter((x) => !(x.muted && x.end <= nowMin));
  const r = tl.rules;
  const workLabel = r.work ? (r.office ? `🏢 Office day · ${toHHMM(r.work[0])}–${toHHMM(r.work[1])}` : `💼 Work ${toHHMM(r.work[0])}–${toHHMM(r.work[1])}`) : "Day off";

  return (
    <section aria-label="Today's plan">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Today</h2>
        <span className="text-xs text-muted">{workLabel}</span>
      </div>

      {done.length > 0 && (
        <div className="px-1">
          <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="flex min-h-10 items-center gap-1.5 text-sm text-muted">
            <span className="text-accent">✓</span> {done.length} done {showDone ? "▴" : "▾"}
          </button>
          {showDone && (
            <ul className="mb-1 opacity-80">
              {done.map((it) => (
                <Row key={it.key} it={it} ctx={ctx} tl={tl} nowMin={nowMin} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </div>
      )}

      {visible.length ? (
        <ul>
          {visible.map((it) => (
            <Row key={it.key} it={it} ctx={ctx} tl={tl} nowMin={nowMin} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="px-1 py-3 text-sm text-muted">{done.length ? "That's everything. Enjoy the rest of your day." : "Nothing planned. A light day is fine."}</p>
      )}

      {tl.clashes.length > 0 && (
        <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-sm" role="status">
          ⚠️ {tl.clashes[0][0].title} and {tl.clashes[0][1].title} overlap
          {tl.clashes.length > 1 ? ` (+${tl.clashes.length - 1} more)` : ""}. Both are booked, so they can't move.
        </p>
      )}

      {tl.overflow.length > 0 && (
        <div className="mt-3 rounded-2xl border border-dashed border-line p-3">
          <p className="text-sm font-medium">Waiting for room · {tl.overflow.length}</p>
          <p className="mt-0.5 text-xs text-muted">
            {tl.overflow
              .slice(0, 3)
              .map((o) => o.task.title)
              .join(" · ")}
            {tl.overflow.length > 3 ? ` +${tl.overflow.length - 3}` : ""}
          </p>
          <p className="mt-1.5 text-xs text-muted">Today's evening is full. {tl.overflow.some((o) => o.carried) ? "Overdue ones are first in line tomorrow." : "They move to the next day with room."}</p>
          {openPanel && (
            <button onClick={() => openPanel("adjust")} className="mt-2 min-h-9 text-sm font-medium text-accent">
              Adjust my day
            </button>
          )}
        </div>
      )}
    </section>
  );
}
