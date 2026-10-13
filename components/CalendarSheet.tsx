"use client";
import { useMemo, useState } from "react";
import { addDays, dayOfMonth, fromISO, toISO, weekdayShort } from "@/lib/dates";
import { toHHMM } from "@/lib/profile";
import { weekStart } from "@/lib/stats";
import { eventMarkKey, isEventDone, markOf } from "@/lib/fixed";
import { buzz } from "@/lib/haptics";
import { actions, useData } from "@/lib/store";
import { buildTimeline, type TLItem, type Timeline } from "@/lib/timeline";
import type { AppData, FixedEvent, ISODate } from "@/lib/types";
import type { RescheduleTarget } from "@/lib/reschedule";
import { AlarmButton } from "./AlarmButton";
import { EventChip } from "./CategoryChip";
import { RescheduleSheet } from "./RescheduleSheet";
import { EventSheet, ItemSheet } from "./TodayPlan";
import { LaterView } from "./LaterView";
import { btn, Chip, field, Sheet, type ViewCtx } from "./ui";

type View = "week" | "month" | "someday";
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The things worth showing in a calendar (no breaks, no commute). */
const shown = (tl: Timeline) => tl.items.filter((x) => !x.muted);

const dotClass = (it: TLItem) =>
  it.kind === "event" || it.kind === "calendar" ? "bg-warn" : it.kind === "session" ? "bg-muted" : it.kind === "bill" || it.kind === "chore" ? "bg-ink/40" : "bg-accent";

function Dots({ items }: { items: TLItem[] }) {
  // One dot per kind, so a busy day doesn't turn into confetti.
  const kinds = [...new Map(items.filter((x) => !x.done).map((x) => [dotClass(x), x])).values()].slice(0, 4);
  return (
    <span className="flex h-1.5 justify-center gap-0.5" aria-hidden="true">
      {kinds.map((k) => (
        <span key={dotClass(k)} className={`h-1.5 w-1.5 rounded-full ${dotClass(k)}`} />
      ))}
    </span>
  );
}

function AgendaRow({ it, onOpen, missed }: { it: TLItem; onOpen: (it: TLItem) => void; missed?: boolean }) {
  const isEvent = it.kind === "event" || it.kind === "calendar";
  return (
    <li>
      <button onClick={() => onOpen(it)} className="flex min-h-11 w-full items-center gap-3 border-b border-line py-1.5 text-left">
        <span className="w-12 shrink-0 text-xs tabular-nums text-muted">{it.allDay ? "all day" : toHHMM(it.start)}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(it)}`} aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate text-[15px] ${it.done ? "text-muted line-through" : ""}`}>
          {it.emoji ? `${it.emoji} ` : ""}
          {it.title}
        </span>
        {missed && <Chip tone="warn">missed</Chip>}
        {it.carried && <Chip tone="warn">carried</Chip>}
        {it.fromCalendar && <Chip>calendar</Chip>}
        {!isEvent && !it.done && it.end > it.start && <span className="text-xs text-muted">{it.end - it.start} min</span>}
      </button>
    </li>
  );
}

/**
 * Calendar: week and month views of everything on your plate: tasks, sessions, events (yours and the phone's), bills.
 * Tap a day for its agenda. "Someday" holds the tasks that have no date.
 */
export function CalendarSheet({ data, ctx, onClose, initialDay }: { data: AppData; ctx: ViewCtx; onClose: () => void; initialDay?: ISODate }) {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<ISODate>(initialDay ?? ctx.today);
  const [selected, setSelected] = useState<ISODate>(initialDay ?? ctx.today);
  const [event, setEvent] = useState<FixedEvent | null>(null);
  /** A session, chore or bill opened from any day: the same sheet as on Today. */
  const [item, setItem] = useState<{ it: TLItem; date: ISODate } | null>(null);
  const [resched, setResched] = useState<RescheduleTarget | null>(null);

  const now = useMemo(() => new Date(), []);
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const first = weekStart(monthStart);
  const weeksInGrid = Math.ceil((((fromISO(monthStart).getDay() + 6) % 7) + new Date(fromISO(monthStart).getFullYear(), fromISO(monthStart).getMonth() + 1, 0).getDate()) / 7);
  const gridDays = Array.from({ length: weeksInGrid * 7 }, (_, i) => addDays(first, i));
  const weekFirst = weekStart(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekFirst, i));

  const days = view === "month" ? gridDays : weekDays;
  const timelines = useMemo(() => new Map(days.map((d) => [d, buildTimeline(data, d, now)])), [data, view, anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (it: TLItem, date: ISODate) => {
    if (it.taskId) return ctx.open(it.taskId);
    if (it.kind === "session" || it.kind === "chore" || it.kind === "bill") return setItem({ it, date });
    if (it.eventId) {
      const e = [...(data.events ?? []), ...(data.calendarEvents ?? [])].find((x) => x.id === it.eventId);
      if (e) setEvent(e);
    }
  };

  const move = (dir: -1 | 1) => {
    if (view === "week") setAnchor(addDays(anchor, dir * 7));
    else {
      const d = fromISO(monthStart);
      setAnchor(toISO(new Date(d.getFullYear(), d.getMonth() + dir, 1)));
    }
  };
  const title = view === "month" ? `${MONTHS[fromISO(monthStart).getMonth()]} ${fromISO(monthStart).getFullYear()}` : `${weekdayShort(weekDays[0])} ${dayOfMonth(weekDays[0])} – ${weekdayShort(weekDays[6])} ${dayOfMonth(weekDays[6])} ${MONTHS[fromISO(weekDays[6]).getMonth()].slice(0, 3)}`;

  const isMissed = (it: TLItem, d: ISODate) => d < ctx.today && !it.done && !it.skipped && (it.kind === "session" || it.kind === "chore" || it.kind === "bill");
  // The selected day is usually one of the days already built; only a day outside the shown span is built (once per data version).
  const selectedTl = useMemo(() => timelines.get(selected) ?? buildTimeline(data, selected, now), [timelines, selected, data, now]);

  return (
    <Sheet title="Calendar" onClose={onClose}>
      <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="tablist" aria-label="Calendar view">
        {(
          [
            ["week", "Week"],
            ["month", "Month"],
            ["someday", "Someday"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`min-h-11 flex-1 rounded-lg ${view === k ? "bg-surface shadow-sm" : "text-muted"}`}>
            {l}
          </button>
        ))}
      </div>

      {view === "someday" ? (
        <LaterView data={data} ctx={ctx} />
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between">
            <button onClick={() => move(-1)} aria-label="Previous" className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-muted hover:bg-bg">
              ‹
            </button>
            <button
              onClick={() => {
                setAnchor(ctx.today);
                setSelected(ctx.today);
              }}
              className="min-h-11 px-3 text-[15px] font-semibold"
            >
              {title}
            </button>
            <button onClick={() => move(1)} aria-label="Next" className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-muted hover:bg-bg">
              ›
            </button>
          </div>

          {view === "month" ? (
            <>
              <div className="mt-1 grid grid-cols-7 gap-y-1 text-center" role="grid" aria-label={title}>
                {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
                  <span key={i} className="pb-1 text-[11px] font-medium text-muted">
                    {l}
                  </span>
                ))}
                {gridDays.map((d) => {
                  const inMonth = d.slice(0, 7) === monthStart.slice(0, 7);
                  const active = d === selected;
                  const tl = timelines.get(d);
                  return (
                    <button
                      key={d}
                      role="gridcell"
                      aria-selected={active}
                      aria-label={`${d}${d === ctx.today ? ", today" : ""}`}
                      onClick={() => setSelected(d)}
                      className={`mx-0.5 flex min-h-12 flex-col items-center justify-center rounded-xl py-1 ${active ? "bg-accent text-accent-ink" : d === ctx.today ? "bg-accent-soft" : ""} ${inMonth ? "" : "opacity-40"}`}
                    >
                      <span className="text-[15px] font-medium leading-tight">{dayOfMonth(d)}</span>
                      {tl && <Dots items={shown(tl)} />}
                    </button>
                  );
                })}
              </div>
              <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">
                {selected === ctx.today ? "Today" : `${weekdayShort(selected)} ${dayOfMonth(selected)} ${MONTHS[fromISO(selected).getMonth()].slice(0, 3)}`}
              </h3>
              {shown(selectedTl).length ? (
                <ul>
                  {shown(selectedTl).map((it) => (
                    <AgendaRow key={it.key} it={it} onOpen={(x) => open(x, selected)} missed={isMissed(it, selected)} />
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-sm text-muted">Nothing planned.</p>
              )}
            </>
          ) : (
            <div className="mt-1 space-y-4">
              {weekDays.map((d) => {
                const tl = timelines.get(d)!;
                const items = shown(tl);
                return (
                  <section key={d} aria-label={d}>
                    <h3 className={`mb-0.5 flex items-baseline gap-2 text-sm font-semibold ${d === ctx.today ? "text-accent" : ""}`}>
                      {d === ctx.today ? "Today" : weekdayShort(d)}
                      <span className="text-xs font-normal text-muted">
                        {dayOfMonth(d)} {MONTHS[fromISO(d).getMonth()].slice(0, 3)}
                      </span>
                    </h3>
                    {items.length ? (
                      <ul>
                        {items.map((it) => (
                          <AgendaRow key={it.key} it={it} onOpen={(x) => open(x, d)} missed={isMissed(it, d)} />
                        ))}
                      </ul>
                    ) : (
                      <p className="border-b border-line py-2 text-sm text-muted">Free</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {item && <ItemSheet item={item.it} date={item.date} left={1} ctx={ctx} onClose={() => setItem(null)} onReschedule={(it) => setResched({ kind: "item", item: it, date: item.date })} />}
      {resched && <RescheduleSheet target={resched} ctx={ctx} onClose={() => setResched(null)} />}
      {event && (event.source === "calendar" ? <CalendarEventInfo event={event} onClose={() => setEvent(null)} notify={ctx.notify} ctx={ctx} /> : <EventSheet event={event} data={data} ctx={ctx} onClose={() => setEvent(null)} />)}
    </Sheet>
  );
}

/**
 * An event from the phone's calendar. Tick it done, hide it for the day, or give it a different time here. These marks live
 * only on this phone: nothing is ever written to your calendar. (Change the event itself in your calendar app.)
 */
export function CalendarEventInfo({ event: raw, onClose, notify, ctx }: { event: FixedEvent; onClose: () => void; notify?: (msg: string, undo?: () => void) => void; ctx?: ViewCtx }) {
  const data = useData();
  const key = eventMarkKey(raw);
  const mark = data ? markOf(data, raw) : undefined;
  const done = data ? isEventDone(data, raw) : false;
  // The calendar's own time, and the local override shown over it.
  const [start, setStart] = useState(mark?.start ?? raw.start ?? "");
  const [end, setEnd] = useState(mark?.end ?? raw.end ?? "");
  const overridden = !!(mark?.start || mark?.end);
  const changed = !!raw.start && (start !== (mark?.start ?? raw.start) || end !== (mark?.end ?? raw.end ?? ""));
  return (
    <Sheet title={raw.title} onClose={onClose}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        🗓️ {raw.date} · {raw.start ? `${mark?.start ?? raw.start}${(mark?.end ?? raw.end) ? `–${mark?.end ?? raw.end}` : ""}` : "all day"}
        {overridden ? " · time changed here" : ""}
      </p>
      <div className="-mt-2 mb-3">
        <EventChip event={raw} />
      </div>
      <div className="space-y-2">
        {raw.start && ctx && <AlarmButton ctx={ctx} itemKey={`event:${raw.id}`} title={raw.title} date={raw.date} startMin={toMinutes(mark?.start ?? raw.start)} />}
        <button
          className={`${done ? btn.ghost : btn.primary} flex min-h-12 w-full items-center justify-center gap-1.5`}
          onClick={() => {
            buzz(20);
            actions.markEvent(key, { done: done ? undefined : Date.now() });
            notify?.(done ? "Back on the list" : `${raw.title}: done`);
            onClose();
          }}
        >
          ✓ {done ? "Not done after all" : "Done"}
        </button>
        <button
          className={`${btn.ghost} min-h-12 w-full`}
          onClick={() => {
            actions.markEvent(key, { hidden: true });
            notify?.(`${raw.title}: hidden for today`, () => actions.markEvent(key, { hidden: undefined }));
            onClose();
          }}
        >
          Hide for today
        </button>
      </div>

      {raw.start && (
        <div className="mt-4 rounded-2xl border border-line p-3">
          <p className="mb-2 text-sm font-semibold">Different time (only here)</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} aria-label="Starts" />
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} aria-label="Ends" />
          </div>
          <div className="mt-2 flex gap-2">
            {changed && (
              <button
                className={`${btn.primary} min-h-12 flex-1`}
                disabled={!start}
                onClick={() => {
                  actions.markEvent(key, { start: start === raw.start ? undefined : start, end: end && end !== raw.end ? end : undefined });
                  notify?.("Time changed on this phone. Your calendar is untouched.");
                  onClose();
                }}
              >
                Save time
              </button>
            )}
            {overridden && (
              <button
                className={`${btn.ghost} min-h-12 flex-1`}
                onClick={() => {
                  actions.markEvent(key, { start: undefined, end: undefined });
                  onClose();
                }}
              >
                Use the calendar's time
              </button>
            )}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Done, hidden and time changes are stored on this phone only. Your calendar is never changed.</p>
    </Sheet>
  );
}
