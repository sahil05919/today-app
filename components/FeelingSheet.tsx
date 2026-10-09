"use client";
import { useMemo, useState } from "react";
import { applyChoice, buildChoice, planChoice } from "@/lib/feeling";
import { formatMinutes } from "@/lib/dates";
import { tickHint } from "@/lib/load";
import { actions, getData } from "@/lib/store";
import type { AppData, Energy } from "@/lib/types";
import { btn, Sheet, type ViewCtx } from "./ui";

const MOODS: Array<[Energy, string, string]> = [
  ["low", "😴", "Low"],
  ["ok", "🙂", "Okay"],
  ["high", "⚡", "Great"],
];

/**
 * "How are you feeling?" Pick the energy, then choose what today holds. Sahil chooses; the app only suggests a realistic
 * set and says why. "Make it work" keeps the ticked things today and moves the rest to the next days with room.
 */
export function FeelingSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const now = useMemo(() => new Date(), []);
  const [energy, setEnergy] = useState<Energy>("ok");
  const hint = useMemo(() => tickHint(data, now, energy), [data, now, energy]);
  const choice = useMemo(() => buildChoice(data, now, energy, hint.hint), [data, now, energy, hint]);
  // The ticks start from the suggestion; once he touches one, they're his. Changing energy offers a fresh suggestion.
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const isTicked = (key: string, suggested: boolean) => (key in edited ? edited[key] : suggested);
  const tickedKeys = useMemo(() => new Set(choice.items.filter((i) => isTicked(i.key, i.ticked)).map((i) => i.key)), [choice, edited]); // eslint-disable-line react-hooks/exhaustive-deps
  const flexible = choice.items.filter((i) => !i.locked);
  const keptMin = choice.items.filter((i) => !i.locked && tickedKeys.has(i.key)).reduce((n, i) => n + i.minutes, 0);
  const plan = useMemo(() => planChoice(data, now, tickedKeys), [data, now, tickedKeys]);

  const pick = (e: Energy) => {
    setEnergy(e);
    setEdited({});
  };

  const go = () => {
    const prev = getData();
    applyChoice(plan, actions);
    actions.answerFeeling({ date: ctx.today, energy, ticked: flexible.filter((i) => tickedKeys.has(i.key)).length, offered: flexible.length });
    ctx.notify(plan.summary, () => actions.replaceAll(prev));
    onClose();
  };

  const justTell = () => {
    actions.answerFeeling({ date: ctx.today, energy, ticked: flexible.length, offered: flexible.length });
    ctx.notify(`Thanks, ${ctx.profile.name}. Have a good one.`);
    onClose();
  };

  return (
    <Sheet title={`How are you feeling, ${ctx.profile.name}?`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Energy">
        {MOODS.map(([e, emoji, label]) => (
          <button key={e} role="radio" aria-checked={energy === e} onClick={() => pick(e)} className={`flex min-h-20 flex-col items-center justify-center rounded-2xl border px-2 py-2 ${energy === e ? "border-accent bg-accent-soft" : "border-line bg-bg"}`}>
            <span className="text-3xl" aria-hidden="true">
              {emoji}
            </span>
            <span className="mt-0.5 text-sm font-semibold">{label}</span>
          </button>
        ))}
      </div>

      <h3 className="mb-1 mt-5 text-sm font-semibold">What does today hold?</h3>
      <p className="mb-2 text-xs text-muted">{choice.note}</p>
      {hint.progress && <p className="mb-2 text-xs text-muted">{hint.progress}</p>}

      {choice.items.length ? (
        <ul className="space-y-1.5">
          {choice.items.map((i) => {
            const on = isTicked(i.key, i.ticked);
            return (
              <li key={i.key}>
                <label className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-1.5 ${i.locked ? "border-line bg-bg opacity-80" : on ? "border-accent/50 bg-accent-soft" : "border-line bg-surface"}`}>
                  <input type="checkbox" checked={i.locked || on} disabled={i.locked} onChange={(e) => setEdited((x) => ({ ...x, [i.key]: e.target.checked }))} className="h-5 w-5 shrink-0 accent-[var(--accent)]" aria-label={i.title} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">
                      {i.emoji ? `${i.emoji} ` : ""}
                      {i.title}
                    </span>
                    <span className="block text-xs text-muted">
                      {i.locked ? `🔒 ${i.lockNote}` : formatMinutes(i.minutes)}
                      {i.carried ? " · carried over" : ""}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl bg-bg p-3 text-sm text-muted">Nothing left to plan today. Enjoy it.</p>
      )}

      {flexible.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          {plan.movedCount ? plan.summary : `Keeping ${formatMinutes(keptMin)} today. ${plan.summary}`}
          {plan.warnings.map((w) => (
            <span key={w} className="mt-1 block text-warn">
              {w}
            </span>
          ))}
        </p>
      )}

      <div className="mt-4 space-y-1">
        <button className={`${btn.primary} min-h-12 w-full text-base`} onClick={go}>
          Make it work
        </button>
        <button className={`${btn.link} min-h-11 w-full`} onClick={justTell}>
          Just checking in, no changes
        </button>
      </div>
    </Sheet>
  );
}
