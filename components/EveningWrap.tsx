"use client";
import { useMemo, useState } from "react";
import { friendlyDate, toISO, addDays } from "@/lib/dates";
import { actions } from "@/lib/store";
import type { Task } from "@/lib/types";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

/** Roll what's left forward with one tap. Nothing is lost, and it can be undone. */
export function EveningWrap({ tasks, ctx, onClose }: { tasks: Task[]; ctx: ViewCtx; onClose: () => void }) {
  const tomorrow = addDays(ctx.today, 1);
  const left = useMemo(
    () => tasks.filter((t) => t.status === "open" && ((t.due != null && t.due <= ctx.today) || t.focus)),
    [tasks, ctx.today],
  );
  const doneToday = tasks.filter((t) => t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) === ctx.today).length;
  const [skip, setSkip] = useState<string[]>([]);
  const roll = left.filter((t) => !skip.includes(t.id));

  const close = () => {
    actions.settings({ wrapDate: ctx.today });
    onClose();
  };

  const rollForward = () => {
    const prev = roll.map((t) => ({ id: t.id, due: t.due, dueTime: t.dueTime, focus: t.focus, snoozeCount: t.snoozeCount }));
    for (const t of roll) actions.update(t.id, { due: tomorrow, focus: false });
    ctx.notify(`Rolled ${roll.length} to tomorrow. Rest well.`, () => {
      for (const p of prev) actions.update(p.id, { due: p.due, dueTime: p.dueTime, focus: p.focus, snoozeCount: p.snoozeCount });
    });
    close();
  };

  return (
    <Sheet title="Wrap up the day" onClose={close}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        {doneToday > 0 ? `You finished ${doneToday} ${doneToday === 1 ? "thing" : "things"} today. ` : "Not every day is a big one. "}
        {left.length ? "Here's what's left. Tap to leave any behind." : "Nothing is left over, so you're free."}
      </p>

      {left.length > 0 && (
        <ul className="space-y-2">
          {left.map((t) => {
            const on = !skip.includes(t.id);
            return (
              <li key={t.id}>
                <button
                  onClick={() => setSkip((s) => (on ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                  aria-pressed={on}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left ${
                    on ? "border-accent bg-accent-soft" : "border-line bg-bg opacity-70"
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-muted/40"}`}>
                    {on ? "→" : ""}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug">
                    {t.title}
                    {t.due && t.due < ctx.today && (
                      <span className="ml-2 align-middle">
                        <Chip tone="warn">{friendlyDate(t.due, ctx.today)}</Chip>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 space-y-2">
        {roll.length > 0 && (
          <button className={`${btn.primary} min-h-12 w-full`} onClick={rollForward}>
            Roll {roll.length} to tomorrow
          </button>
        )}
        <button className={`${btn.ghost} min-h-12 w-full`} onClick={close}>
          {left.length ? "Leave them as they are" : "Done for today"}
        </button>
      </div>
    </Sheet>
  );
}
