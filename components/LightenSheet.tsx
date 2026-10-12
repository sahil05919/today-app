"use client";
import { useMemo, useState } from "react";
import { freeMinutesToday, minutesText, preTicked, pullCandidates, type PullReason } from "@/lib/lighten";
import { friendlyDate } from "@/lib/dates";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

const WHY: Record<PullReason, string> = { waiting: "waiting for room", behind: "behind this week", important: "important", busiest: "from your busiest day" };

/**
 * "Lighten my week": suggestions from the next 7 days that fit the free time left today, with tick boxes and a running total.
 * Nothing moves until you confirm. Pulled items MOVE (they leave the future day) and keep their session numbers.
 */
export function LightenSheet({ data, ctx, now: nowProp, onClose }: { data: AppData; ctx: ViewCtx; now: Date; onClose: () => void }) {
  // Judged at the moment it was opened, so the list does not shift under your finger.
  const [now] = useState(() => nowProp);
  const free = useMemo(() => freeMinutesToday(data, now), [data, now]);
  const cands = useMemo(() => pullCandidates(data, now), [data, now]);
  const [ticked, setTicked] = useState<Set<string>>(() => preTicked(data, now, cands, free));
  const picks = cands.filter((c) => ticked.has(c.key));
  const total = picks.reduce((n, c) => n + c.minutes, 0);
  const over = total > free;

  const toggle = (key: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <Sheet title="Lighten my week" onClose={onClose}>
      {cands.length === 0 ? (
        <p className="py-6 text-center text-[15px]">Nothing to pull forward. Your week is already light 🎉</p>
      ) : (
        <>
          <p className="-mt-1 mb-2 text-sm text-muted">
            {free >= 15 ? "Pick what to bring into today. Nothing moves until you confirm." : "Not much time is left today, but you can still pick a little."}
          </p>
          <p className={`mb-3 rounded-xl px-3 py-2 text-sm font-semibold ${over ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"}`} role="status" aria-live="polite">
            {picks.length ? `${minutesText(total)} of ${minutesText(free)} free` : `${minutesText(free)} free this evening`}
            {over ? " · more than fits" : ""}
          </p>
          <ul className="space-y-1.5">
            {cands.map((c) => (
              <li key={c.key}>
                <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-bg px-3 py-2">
                  <input type="checkbox" checked={ticked.has(c.key)} onChange={() => toggle(c.key)} className="h-6 w-6 shrink-0 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{c.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>
                        {minutesText(c.minutes)} · {friendlyDate(c.from, ctx.today)}
                      </span>
                      <Chip tone={c.reason === "waiting" || c.reason === "behind" ? "warn" : "plain"}>{WHY[c.reason]}</Chip>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            className={`${btn.primary} mt-4 min-h-12 w-full`}
            disabled={!picks.length}
            onClick={() => {
              const r = actions.pullForward(picks, now);
              if (r) ctx.notify(r.message, r.undo);
              onClose();
            }}
          >
            {picks.length ? `Bring ${picks.length} into today` : "Pick something"}
          </button>
        </>
      )}
    </Sheet>
  );
}
