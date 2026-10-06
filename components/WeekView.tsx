"use client";
import { addDays, dayOfMonth, diffDays, weekdayShort } from "@/lib/dates";
import type { AppData, ISODate } from "@/lib/types";
import { TaskCard } from "./TaskCard";
import { Empty, SectionTitle, sortTasks, type ViewCtx } from "./ui";

export function WeekView({
  data,
  ctx,
  selected,
  onSelect,
}: {
  data: AppData;
  ctx: ViewCtx;
  selected: ISODate;
  onSelect: (d: ISODate) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(ctx.today, i));
  const open = data.tasks.filter((t) => t.status === "open");
  const overdue = sortTasks(open.filter((t) => t.due != null && diffDays(t.due, ctx.today) < 0));
  const onDay = (d: ISODate) => open.filter((t) => t.due === d);
  const dayTasks = sortTasks(onDay(selected));
  const doneOnDay = data.tasks.filter((t) => t.status === "done" && t.due === selected);

  return (
    <div>
      <div className="mt-2 grid grid-cols-7 gap-1.5" role="tablist" aria-label="Next 7 days">
        {days.map((d) => {
          const n = onDay(d).length;
          const active = d === selected;
          return (
            <button
              key={d}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(d)}
              className={`flex flex-col items-center rounded-2xl border py-2 transition ${
                active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"
              }`}
            >
              <span className={`text-[11px] font-medium ${active ? "opacity-90" : "text-muted"}`}>{d === ctx.today ? "Today" : weekdayShort(d)}</span>
              <span className="text-lg font-semibold leading-tight">{dayOfMonth(d)}</span>
              <span className="mt-1 flex h-1.5 gap-0.5">
                {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent-ink" : "bg-accent"}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {overdue.length > 0 && (
        <>
          <SectionTitle>Slipped past</SectionTitle>
          <div className="space-y-2">
            {overdue.map((t) => (
              <TaskCard key={t.id} task={t} ctx={ctx} />
            ))}
          </div>
        </>
      )}

      <SectionTitle right={`${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"}`}>
        {selected === ctx.today ? "Today" : `${weekdayShort(selected)} ${dayOfMonth(selected)}`}
      </SectionTitle>
      {dayTasks.length ? (
        <div className="space-y-2">
          {dayTasks.map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} />
          ))}
        </div>
      ) : (
        <Empty>Nothing planned. Anything you capture here lands on this day.</Empty>
      )}

      {doneOnDay.length > 0 && (
        <div className="mt-4 space-y-2">
          {doneOnDay.map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}
