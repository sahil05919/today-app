"use client";
import { useMemo, useState } from "react";
import { describeSchedule, nextDue } from "@/lib/bills";
import { diffDays, friendlyDate } from "@/lib/dates";
import { parseCapture } from "@/lib/parse";
import { actions } from "@/lib/store";
import type { AppData, BoredIdea, Goal } from "@/lib/types";
import { CheckIcon } from "./icons";
import { btn, Chip, field, Sheet, type ViewCtx } from "./ui";

/** Your shopping list. You fill it; nothing is added for you. The Saturday grocery reminder reads it out. */
export function ShoppingSheet({ data, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [text, setText] = useState("");
  const items = data.grocery ?? [];
  const open = items.filter((g) => !g.done);
  const bought = items.filter((g) => g.done);

  const add = () => {
    const names = text.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (names.length) actions.addGrocery(names.map((n) => n.charAt(0).toUpperCase() + n.slice(1)));
    setText("");
  };

  return (
    <Sheet title="Shopping list" onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Milk, sugar…" aria-label="Add to the list" className={field} />
        <button type="submit" disabled={!text.trim()} className={`${btn.primary} min-h-11`}>
          Add
        </button>
      </form>
      <p className="mb-3 mt-1.5 text-xs text-muted">Tip: type “groceries: milk, sugar” in the capture bar. On Saturday I'll remind you what's on here.</p>

      {open.length === 0 && bought.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing on the list.</p>}
      <ul className="divide-y divide-line">
        {[...open, ...bought].map((g) => (
          <li key={g.id} className="flex items-center">
            <button onClick={() => actions.toggleGrocery(g.id)} aria-label={g.done ? `Put ${g.name} back` : `${g.name} bought`} className="flex h-12 w-11 shrink-0 items-center justify-center">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${g.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"}`}>
                <CheckIcon width={14} height={14} />
              </span>
            </button>
            <span className={`min-w-0 flex-1 truncate text-[15px] ${g.done ? "text-muted line-through" : ""}`}>{g.name}</span>
            <button onClick={() => actions.removeGrocery(g.id)} aria-label={`Remove ${g.name}`} className="flex h-11 w-11 items-center justify-center text-muted">
              ✕
            </button>
          </li>
        ))}
      </ul>
      {bought.length > 0 && (
        <button className={`${btn.ghost} mt-3 min-h-11 w-full`} onClick={() => actions.clearBought()}>
          Clear {bought.length} bought
        </button>
      )}
    </Sheet>
  );
}

/** Bills and recurring chores: what's next, and a one-tap "done". Edit them in Settings. */
export function BillsSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const rows = useMemo(
    () =>
      (data.bills ?? [])
        .filter((b) => b.enabled)
        .map((b) => ({ b, due: b.autopay ? null : nextDue(b, ctx.today) }))
        .sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999")),
    [data.bills, ctx.today],
  );
  return (
    <Sheet title="Bills & chores" onClose={onClose}>
      <ul className="space-y-2.5">
        {rows.map(({ b, due }) => {
          const n = due ? diffDays(due, ctx.today) : null;
          return (
            <li key={b.id} className="rounded-2xl border border-line bg-bg p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{b.name}</p>
                  <p className="text-xs text-muted">
                    {describeSchedule(b)}
                    {b.remindDaysBefore.length && !b.autopay ? ` · reminds ${b.remindDaysBefore.map((d) => (d === 0 ? "on the day" : `${d}d before`)).join(", ")}` : ""}
                  </p>
                </div>
                {b.autopay ? <Chip tone="accent">Autopay</Chip> : due && <Chip tone={n !== null && n <= 3 ? "warn" : "plain"}>{n === 0 ? "Today" : friendlyDate(due, ctx.today)}</Chip>}
              </div>
              {!b.autopay && due && (
                <button
                  className={`${btn.soft} mt-2.5 min-h-11 w-full`}
                  onClick={() => {
                    actions.completeBill(b.id, due);
                    ctx.notify(`${b.name}: done`);
                  }}
                >
                  {b.kind === "chore" ? "✓ Done" : "✓ Paid"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">Edit amounts, dates and reminders in Settings → Bills & chores.</p>
    </Sheet>
  );
}

const monthOf = (today: string) => today.slice(0, 7);

/** This month's must-haves. */
export function GoalsSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const month = monthOf(ctx.today);
  const items: Goal[] = data.goals?.month === month ? data.goals.items : [];
  const [text, setText] = useState("");
  const save = (next: Goal[]) => actions.setGoals(month, next);

  return (
    <Sheet title="This month's must-haves" onClose={onClose}>
      <p className="-mt-1 mb-3 text-sm text-muted">The few things that would make this month a good one. They stay pinned at the top of Today.</p>
      <ul className="divide-y divide-line">
        {items.map((g) => (
          <li key={g.id} className="flex items-center">
            <button onClick={() => save(items.map((x) => (x.id === g.id ? { ...x, done: !x.done } : x)))} aria-label={g.done ? "Not done" : "Done"} className="flex h-12 w-11 shrink-0 items-center justify-center">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${g.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"}`}>
                <CheckIcon width={14} height={14} />
              </span>
            </button>
            <span className={`min-w-0 flex-1 text-[15px] ${g.done ? "text-muted line-through" : ""}`}>{g.text}</span>
            <button onClick={() => save(items.filter((x) => x.id !== g.id))} aria-label={`Remove ${g.text}`} className="flex h-11 w-11 items-center justify-center text-muted">
              ✕
            </button>
          </li>
        ))}
      </ul>
      {items.length < 5 ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            save([...items, { id: crypto.randomUUID(), text: t.slice(0, 120), done: false }]);
            setText("");
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Finish the Power BI course" aria-label="New must-have" className={field} />
          <button type="submit" disabled={!text.trim()} className={`${btn.primary} min-h-11`}>
            Add
          </button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-muted">Five is plenty. Finish one before adding another.</p>
      )}
    </Sheet>
  );
}

/** Ideas to pull from when you have free time (the "Ideas" half of Free time ideas). */
export function BoredBody({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const ideas = data.bored ?? [];
  const [pick, setPick] = useState<BoredIdea | null>(null);
  const [text, setText] = useState("");

  const roll = () => {
    const pool = ideas.filter((i) => i.id !== pick?.id);
    if (pool.length) setPick(pool[Math.floor(Math.random() * pool.length)]);
  };

  return (
    <div>
      {pick ? (
        <div className="rounded-2xl bg-accent-soft p-4 text-center">
          <p className="text-lg font-semibold">{pick.text}</p>
          <div className="mt-3 flex justify-center gap-2">
            <button
              className={`${btn.primary} min-h-11`}
              onClick={() => {
                const p = parseCapture(`${pick.text} today`, new Date(), ctx.profile);
                actions.addTask({ ...p, area: pick.areaId ?? p.area });
                ctx.notify("Added to today. Go on, then.");
                onClose();
              }}
            >
              Do it today
            </button>
            <button className={`${btn.ghost} min-h-11`} onClick={roll}>
              Another
            </button>
          </div>
        </div>
      ) : (
        <button className={`${btn.primary} min-h-14 w-full text-base`} onClick={roll} disabled={!ideas.length}>
          🎲 Pick something for me
        </button>
      )}

      <h3 className="mb-1.5 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">Your ideas</h3>
      <ul className="divide-y divide-line">
        {ideas.map((i) => (
          <li key={i.id} className="flex min-h-11 items-center">
            <span className="min-w-0 flex-1 text-[15px]">{i.text}</span>
            <button onClick={() => actions.setIdeas(ideas.filter((x) => x.id !== i.id))} aria-label={`Remove ${i.text}`} className="flex h-11 w-11 items-center justify-center text-muted">
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          actions.setIdeas([...ideas, { id: crypto.randomUUID(), text: t.slice(0, 120) }]);
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an idea…" aria-label="New idea" className={field} />
        <button type="submit" disabled={!text.trim()} className={`${btn.soft} min-h-11`}>
          Add
        </button>
      </form>
    </div>
  );
}
