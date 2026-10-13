"use client";
import { useState } from "react";
import { autoRows, chipCount, GROUP_TITLE, itemOf, rowText, type AutoGroup, type AutoRow } from "@/lib/autoLog";
import { actions } from "@/lib/store";
import type { AppData, FixedEvent } from "@/lib/types";
import { CalendarEventInfo } from "./CalendarSheet";
import { btn, Sheet, type ViewCtx } from "./ui";

/** "🤖 App added 4 today": near the top of Home, only while something the app did by itself is still unreviewed. */
export function AppDidChip({ data, now, onOpen }: { data: AppData; now: Date; onOpen: () => void }) {
  const n = chipCount(data, now);
  if (!n) return null;
  return (
    <button onClick={onOpen} className="flex min-h-11 w-full items-center gap-2 rounded-2xl bg-accent-soft px-3.5 py-2 text-left text-[15px] font-medium text-accent" aria-label={`The app added ${n}. See what it did`}>
      <span aria-hidden="true">🤖</span>
      <span className="flex-1">App added {n} today</span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

const ORDER: AutoGroup[] = ["gmail", "calendar", "planner", "life"];

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** What the app did: grouped, with Seen / Open / Remove (or Undo move) on every line. */
export function AppDidSheet({ data, ctx, now, onClose }: { data: AppData; ctx: ViewCtx; now: Date; onClose: () => void }) {
  const rows = autoRows(data, now);
  const [open, setOpen] = useState<string | null>(null);
  const [event, setEvent] = useState<FixedEvent | null>(null);
  const unseen = rows.filter((r) => r.unreviewed).length;

  const openItem = (r: AutoRow) => {
    const it = itemOf(r.entries[0]);
    if (!it) return;
    if (it.kind === "task" || it.kind === "occ") {
      onClose();
      ctx.open(it.id);
    } else if (it.kind === "event") {
      const e = [...(data.events ?? []), ...(data.calendarEvents ?? [])].find((x) => `${x.calId ?? x.id}@${x.date}` === it.id);
      if (e) setEvent(e);
      else ctx.notify("That event is gone.");
    }
  };

  const remove = (r: AutoRow) => {
    const undo = actions.removeAuto(r.entries.map((e) => e.id));
    ctx.notify(undo ? "Removed" : "Already gone", undo ?? undefined);
  };
  const undoMove = (r: AutoRow) => {
    const undo = actions.undoAutoMoves(r.entries.map((e) => e.id));
    ctx.notify(undo ? (r.folded ? "Moves undone" : "Move undone") : "It has moved again since, so I left it", undo ?? undefined);
  };

  const canOpen = (r: AutoRow) => {
    const it = itemOf(r.entries[0]);
    return !r.folded && !!it && it.kind !== "digest";
  };
  const isMove = (r: AutoRow) => r.entries[0].kind !== "added";
  const reversible = (r: AutoRow) => r.entries.some((e) => e.from);

  return (
    <Sheet title="What the app did" onClose={onClose}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="text-sm text-muted">The last 7 days. Nothing is hidden: it all stays in your history.</p>
        <button className={`${btn.soft} min-h-10 shrink-0`} disabled={!unseen} onClick={() => actions.seeAllAuto(now)}>
          Mark all seen
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">Nothing yet. When a task arrives from Gmail, a new event shows up in your calendar, or the planner moves something, it is listed here.</p>
      ) : (
        ORDER.map((g) => {
          const mine = rows.filter((r) => r.group === g);
          if (!mine.length) return null;
          return (
            <section key={g} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{GROUP_TITLE[g]}</h3>
              <ul>
                {mine.map((r) => (
                  <li key={r.id} className={`border-b border-line py-2 ${r.unreviewed ? "" : "opacity-60"}`}>
                    <p className="text-[15px] font-medium leading-snug">
                      {r.unreviewed && (
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-label="not seen yet" />
                      )}
                      {rowText(r)}
                    </p>
                    <p className="text-xs text-muted">{clock(r.at)}</p>
                    {r.folded && (
                      <>
                        <button className="min-h-9 text-xs font-medium text-accent" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                          {open === r.id ? "Hide" : "Show"} the {r.entries.length} moves
                        </button>
                        {open === r.id && (
                          <ul className="mb-1 ml-1 space-y-0.5 border-l-2 border-line pl-3 text-sm">
                            {r.entries.map((e) => (
                              <li key={e.id}>
                                {e.title}
                                <span className="text-xs text-muted">
                                  {" "}
                                  {e.from ? `${e.from.date} → ` : "→ "}
                                  {e.to?.date}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {r.unreviewed && (
                        <button className={`${btn.ghost} min-h-10 px-3`} onClick={() => actions.seeAuto(r.entries.map((e) => e.id))}>
                          Seen ✓
                        </button>
                      )}
                      {canOpen(r) && (
                        <button className={`${btn.ghost} min-h-10 px-3`} onClick={() => openItem(r)}>
                          Open
                        </button>
                      )}
                      {isMove(r) ? (
                        reversible(r) && (
                          <button className={`${btn.ghost} min-h-10 px-3`} onClick={() => undoMove(r)}>
                            Undo move
                          </button>
                        )
                      ) : (
                        <button className={`${btn.ghost} min-h-10 px-3 text-warn`} onClick={() => remove(r)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {event && <CalendarEventInfo event={event} onClose={() => setEvent(null)} notify={ctx.notify} ctx={ctx} />}
    </Sheet>
  );
}
