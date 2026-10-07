"use client";
import { friendlyDate } from "@/lib/dates";
import type { IcsEvent } from "@/lib/calendar";
import { actions } from "@/lib/store";
import { btn, Sheet, type ViewCtx } from "./ui";

/** A calendar invite opened with "Open with Today" (or picked in Settings): shows what's in it, and adds it as fixed blocks. */
export function ImportSheet({ events, ctx, onClose }: { events: IcsEvent[]; ctx: ViewCtx; onClose: () => void }) {
  const add = () => {
    const added = actions.addImportedEvents(events);
    ctx.notify(
      added.length ? `Added ${added.length} ${added.length === 1 ? "event" : "events"}. Sessions move around ${added.length === 1 ? "it" : "them"}.` : "Already in your calendar.",
      added.length ? () => added.forEach((e) => actions.removeEvent(e.id)) : undefined,
    );
    onClose();
  };
  return (
    <Sheet title={events.length === 1 ? "Add this event?" : `Add ${events.length} events?`} onClose={onClose}>
      {events.length ? (
        <>
          <ul className="divide-y divide-line">
            {events.slice(0, 12).map((e, i) => (
              <li key={i} className="py-2.5">
                <p className="text-[15px] font-semibold leading-snug">{e.title}</p>
                <p className="text-sm text-muted">
                  {friendlyDate(e.date, ctx.today)}
                  {e.start ? ` · ${e.start}${e.end ? `–${e.end}` : ""}` : " · all day"}
                  {e.location ? ` · ${e.location}` : ""}
                </p>
              </li>
            ))}
          </ul>
          {events.length > 12 && <p className="mt-1 text-sm text-muted">…and {events.length - 12} more</p>}
          <div className="mt-4 flex gap-2">
            <button className={`${btn.primary} min-h-12 flex-1`} onClick={add}>
              Add to my day
            </button>
            <button className={`${btn.ghost} min-h-12`} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className="py-4 text-center text-sm text-muted">I couldn't find an event in that file.</p>
      )}
    </Sheet>
  );
}
