"use client";
import { useState } from "react";
import { friendlyDate } from "@/lib/dates";
import { digestCard, digestKey } from "@/lib/inbox";
import { remindClashes } from "@/lib/remindClash";
import { toHHMM } from "@/lib/profile";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

/** "Emails that need you": the Gmail add-on's digest for today, from 19:00. Tap to open the list. Dismissible. */
export function DigestCard({ data, now }: { data: AppData; now: Date }) {
  const [open, setOpen] = useState(false);
  const d = digestCard(data, now);
  if (!d) return null;
  return (
    <div className="rounded-2xl bg-accent-soft p-3.5" role="note">
      <div className="flex items-start gap-3">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className="text-2xl" aria-hidden="true">
            📧
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Emails that need you</span>
            <span className="block text-sm text-muted">{d.title}{open ? "" : " · tap to see"}</span>
          </span>
        </button>
        <button onClick={() => actions.settings({ digestDismissed: digestKey(d) })} aria-label="Dismiss" className="-mr-1 min-h-9 px-2 text-muted">
          ✕
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {d.items.map((it, i) => (
            <li key={i} className="rounded-lg bg-surface px-2.5 py-1.5">
              • {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A shift or booking from the Gmail add-on that lands in work hours: adjust the work start that day, or keep it. */
export function RemindClashCard({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const first = remindClashes(data, ctx.today)[0];
  if (!first) return null;
  const { event: e, clash } = first;
  const answer = () => actions.settings({ clashDismissed: [...(data.settings.clashDismissed ?? []), e.id].slice(-100) });
  return (
    <div className="rounded-2xl bg-warn-soft p-3.5" role="alert">
      <p className="text-[15px] font-semibold text-ink">⚠️ {e.title}</p>
      <p className="mt-0.5 text-sm text-muted">
        {friendlyDate(e.date, ctx.today)} {e.start}. {clash.text}
      </p>
      <div className="mt-2.5 flex gap-2">
        {clash.fix && (
          <button
            className={`${btn.primary} min-h-11`}
            onClick={() => {
              actions.setBlock("work", e.date, { start: clash.fix!.start, min: clash.fix!.min }, "today");
              answer();
              ctx.notify(`Work starts at ${toHHMM(clash.fix!.start)} that day`);
            }}
          >
            Adjust work start
          </button>
        )}
        <button className={`${btn.ghost} min-h-11`} onClick={answer}>
          Keep anyway
        </button>
      </div>
    </div>
  );
}
