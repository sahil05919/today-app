"use client";
import { useMemo, useState } from "react";
import { friendlyDate } from "@/lib/dates";
import { clashesFor } from "@/lib/shareClash";
import type { ParsedShare } from "@/lib/shareParse";
import { toHHMM } from "@/lib/profile";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { syncEventToCalendar } from "@/lib/calendarWrite";
import { btn, Chip, field, Sheet, type ViewCtx } from "./ui";

/**
 * Something shared from Gmail, read and waiting for you. Always a confirm sheet: title, date, time and area are all editable,
 * clashes are shown, and NOTHING is saved until you tap the button. A line says how it was read: on this phone, or by Gemini.
 */
export function ShareEventSheet({ share, data, ctx, onClose }: { share: ParsedShare; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [title, setTitle] = useState(share.title);
  const [date, setDate] = useState(share.date);
  const [start, setStart] = useState(share.start ?? "");
  const [end, setEnd] = useState(share.end ?? "");
  const [area, setArea] = useState(share.area ?? "");
  const [keep, setKeep] = useState(false);
  const [adjust, setAdjust] = useState(false);

  const clashes = useMemo(() => clashesFor(data, { date, start: start || undefined, end: start ? end || undefined : undefined }, ctx.today), [data, date, start, end, ctx.today]);
  const work = clashes.find((c) => c.kind === "work");
  const showWarn = clashes.length > 0 && !keep && !adjust;

  const save = () => {
    const e = actions.addFixedEvent({ title: title.trim() || "Booking", date, start: start || undefined, end: start ? end || undefined : undefined, area: area || undefined, status: share.status, shift: share.shift ? true : undefined });
    // A Just-today routine edit: work starts after the event (and still ends when it did).
    if (adjust && work?.fix) actions.setBlock("work", date, { start: work.fix.start, min: work.fix.min }, "today");
    void syncEventToCalendar(e.id).then((r) => {
      if (r === "no-permission") ctx.notify("Added. Allow calendar access in Settings to put it in your Google Calendar too.");
    });
    ctx.notify(`Added: ${e.title}, ${friendlyDate(date, ctx.today)}${start ? ` ${start}${end ? "–" + end : ""}` : ""}`, () => actions.removeEvent(e.id));
    onClose();
  };

  return (
    <Sheet title="Add this to Today?" onClose={onClose}>
      <p className="-mt-1 mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        {share.source === "gemini" ? <Chip tone="warn">Read with Gemini</Chip> : <Chip tone="accent">Read on this phone</Chip>}
        {share.status && <Chip>{share.status}</Chip>}
        <span>Nothing is saved until you confirm.</span>
      </p>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 block">
            <span className="mb-1 block text-xs font-medium text-muted">Date</span>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={field} />
          </label>
          <label className="col-span-1 block">
            <span className="mb-1 block text-xs font-medium text-muted">From</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <label className="col-span-1 block">
            <span className="mb-1 block text-xs font-medium text-muted">To</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} disabled={!start} />
          </label>
          <label className="col-span-1 block">
            <span className="mb-1 block text-xs font-medium text-muted">Area</span>
            <select value={area} onChange={(e) => setArea(e.target.value)} className={field}>
              <option value="">None</option>
              {ctx.profile.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!start && <p className="text-xs text-muted">No time found: it will be an all-day event, and the day&apos;s sessions move elsewhere. Add a time if you know it.</p>}
      </div>

      {showWarn && (
        <div className="mt-4 rounded-2xl bg-warn-soft p-3.5" role="alert">
          {clashes.map((c) => (
            <p key={c.text} className="text-sm font-medium text-ink">
              ⚠️ {c.text}
            </p>
          ))}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {work?.fix && (
              <button className={`${btn.primary} min-h-10`} onClick={() => setAdjust(true)}>
                Adjust work start that day
              </button>
            )}
            <button className={`${btn.ghost} min-h-10`} onClick={() => setKeep(true)}>
              Keep anyway
            </button>
          </div>
        </div>
      )}
      {adjust && work?.fix && <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm">Work will start at {toHHMM(work.fix.start)} that day only.</p>}
      {keep && clashes.length > 0 && <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm">Kept as it is. Booked things are never moved.</p>}

      <button className={`${btn.primary} mt-4 min-h-12 w-full`} onClick={save} disabled={!title.trim()}>
        Add to Today
      </button>
      <button className={`${btn.ghost} mt-2 min-h-11 w-full`} onClick={onClose}>
        Not now
      </button>
    </Sheet>
  );
}
