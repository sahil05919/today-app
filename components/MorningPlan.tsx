"use client";
import { useMemo, useState } from "react";
import { formatMinutes, friendlyDate } from "@/lib/dates";
import { remainingMinutes } from "@/lib/estimate";
import { priorityScore } from "@/lib/rescue";
import { actions } from "@/lib/store";
import { buildDurationModel } from "@/lib/stats";
import type { Task } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { btn, Chip, Sheet, type ViewCtx } from "./ui";

/** Pick today's 3. Suggestions are the most urgent / important open tasks. */
export function MorningPlan({ tasks, ctx, onClose }: { tasks: Task[]; ctx: ViewCtx; onClose: () => void }) {
  const model = useMemo(() => buildDurationModel(tasks), [tasks]);
  const candidates = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "open")
        .sort((a, b) => priorityScore(b, ctx.today) - priorityScore(a, ctx.today) || a.createdAt - b.createdAt)
        .slice(0, 12),
    [tasks, ctx.today],
  );
  const [picked, setPicked] = useState<string[]>(() => {
    const current = candidates.filter((t) => t.focus).map((t) => t.id);
    return (current.length ? current : candidates.slice(0, MAX_FOCUS).map((t) => t.id)).slice(0, MAX_FOCUS);
  });

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_FOCUS ? p : [...p, id]));
  const total = candidates.filter((t) => picked.includes(t.id)).reduce((n, t) => n + remainingMinutes(t, model).minutes, 0);

  const close = () => {
    actions.settings({ planDate: ctx.today });
    onClose();
  };

  return (
    <Sheet title="Plan today" onClose={close}>
      <p className="-mt-1 mb-3 text-sm text-muted">
        Choose up to {MAX_FOCUS} things that would make today a good day. Everything else can wait.
      </p>
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing to plan yet. Capture a task or two first.</p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((t) => {
            const on = picked.includes(t.id);
            const rem = remainingMinutes(t, model);
            return (
              <li key={t.id}>
                <button
                  onClick={() => toggle(t.id)}
                  aria-pressed={on}
                  disabled={!on && picked.length >= MAX_FOCUS}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition disabled:opacity-40 ${
                    on ? "border-accent bg-accent-soft" : "border-line bg-bg"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      on ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"
                    }`}
                  >
                    {picked.indexOf(t.id) + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug">
                      {t.important && <span className="mr-1 font-bold text-accent">!</span>}
                      {t.title}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {t.due && <Chip tone={t.due < ctx.today ? "warn" : "plain"}>{friendlyDate(t.due, ctx.today)}</Chip>}
                      <Chip>
                        {rem.guessed ? "~" : ""}
                        {formatMinutes(rem.minutes)}
                        {rem.learned ? " · your avg" : ""}
                      </Chip>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-3">
        <p className="flex-1 text-sm text-muted">
          {picked.length ? `${picked.length} chosen · about ${formatMinutes(total)}` : "Pick at least one"}
        </p>
        <button
          className={`${btn.primary} min-h-12 px-6`}
          disabled={!picked.length}
          onClick={() => {
            actions.setFocusIds(picked);
            ctx.notify("That's your day. Go gently.");
            close();
          }}
        >
          Set my {picked.length || ""}
        </button>
      </div>
    </Sheet>
  );
}
