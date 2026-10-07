"use client";
import { useMemo } from "react";
import { rangeLabel } from "@/lib/dates";
import { allNextOccurrences, upcomingEvents, type UpcomingEvent } from "@/lib/events";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

const NOTE = "Dates move each year. Check the exact date before you go.";

function saveEvent(u: UpcomingEvent, ctx: ViewCtx, hidden: string[] = []) {
  const e = u.event;
  actions.addTask({
    title: e.title,
    due: u.state === "now" ? ctx.today : u.start,
    important: false,
    tags: ["london"],
    notes: `${e.where}. ${e.usually}. ${NOTE}${e.url ? `\n${e.url}` : ""}`,
  });
  // Saved events stop appearing in the "Don't miss this" strip for that year.
  actions.settings({ hiddenEvents: [...hidden, `${e.id}:${u.year}`] });
  ctx.notify(`Added “${e.title}”. Check the exact date.`);
}

function EventCard({ u, ctx, hidden, compact }: { u: UpcomingEvent; ctx: ViewCtx; hidden: string[]; compact?: boolean }) {
  const e = u.event;
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug">{e.title}</p>
          <p className="text-xs text-muted">{e.where}</p>
        </div>
        <Chip tone={u.state === "now" ? "accent" : "plain"}>{u.state === "now" ? "On now" : rangeLabel(u.start, u.end)}</Chip>
      </div>
      {!compact && <p className="mt-2 text-sm">{e.blurb}</p>}
      <p className="mt-1.5 text-xs text-muted">
        Usually: {e.usually}. <span className="font-medium text-warn">Check the exact date.</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={`${btn.soft} min-h-11 px-4`} onClick={() => saveEvent(u, ctx, hidden)}>
          Add to my list
        </button>
        {e.url && (
          <a className={`${btn.ghost} flex min-h-11 items-center px-4`} href={e.url} target="_blank" rel="noopener noreferrer">
            Official site
          </a>
        )}
        {compact && (
          <button
            className={`${btn.link} min-h-11 px-2`}
            onClick={() => actions.settings({ hiddenEvents: [...hidden, `${e.id}:${u.year}`] })}
          >
            Hide
          </button>
        )}
      </div>
    </div>
  );
}

/** One or two events starting soon, on the Today screen. Renders nothing when there's nothing to show. */
export function EventsStrip({ data, ctx, onAll }: { data: AppData; ctx: ViewCtx; onAll: () => void }) {
  const hidden = data.settings.hiddenEvents ?? [];
  const soon = useMemo(() => upcomingEvents(ctx.today, { hidden }).slice(0, 2), [ctx.today, hidden]);
  if (!soon.length) return null;
  return (
    <section>
      <div className="mb-2 mt-6 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Don't miss this · London</h2>
        <button onClick={onAll} className="text-xs text-muted underline-offset-2 hover:underline">
          See all
        </button>
      </div>
      <div className="space-y-2.5">
        {soon.map((u) => (
          <EventCard key={`${u.event.id}:${u.year}`} u={u} ctx={ctx} hidden={hidden} compact />
        ))}
      </div>
    </section>
  );
}

/** Every curated event with its next usual dates (the "Events" half of Free time ideas). */
export function EventsBody({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const all = useMemo(() => allNextOccurrences(ctx.today), [ctx.today]);
  const hidden = data.settings.hiddenEvents ?? [];
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Recurring events with their usual timing, built into the app so it works offline. {NOTE}
      </p>
      <div className="space-y-2.5">
        {all.map((u) => (
          <EventCard key={`${u.event.id}:${u.year}`} u={u} ctx={ctx} hidden={hidden} />
        ))}
      </div>
    </div>
  );
}
