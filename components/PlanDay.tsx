"use client";
import { useMemo, useRef, useState } from "react";
import { buzz } from "@/lib/haptics";
import { buildDayPlan, slotsFromPlan, type Block, type DayPlan } from "@/lib/planday";
import { toHHMM } from "@/lib/profile";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, Sheet, type ViewCtx } from "./ui";

const PPM = 1.15; // pixels per minute
const SNAP = 15;

/** Hours that are already over aren't useful to look at, so the view starts at what's still ahead. */
const upcoming = (plan: DayPlan) => plan.blocks.filter((b) => b.end > plan.dayStart);

function viewOf(plan: DayPlan) {
  const blocks = upcoming(plan);
  const starts = [plan.dayStart, ...blocks.map((b) => b.start)];
  const ends = [plan.dayEnd, ...blocks.map((b) => b.end)];
  return { start: Math.floor(Math.min(...starts) / 60) * 60, end: Math.ceil(Math.max(...ends) / 60) * 60 };
}

const KIND_STYLE: Record<Block["kind"], string> = {
  work: "z-0 border border-dashed border-accent/40 bg-accent-soft/60 text-accent",
  lunch: "z-10 border border-line bg-bg text-muted",
  commute: "z-10 border border-line bg-bg text-muted",
  gym: "z-10 border border-line bg-bg text-muted",
  event: "z-10 border border-warn/40 bg-warn-soft text-warn",
  task: "z-20 bg-accent text-accent-ink shadow-md",
};
const KIND_EMOJI: Record<Block["kind"], string> = { work: "💼", lunch: "🍽️", commute: "🚌", gym: "💪", event: "📌", task: "" };

/** A timeline for today: fixed blocks plus tasks slotted into the gaps. Drag a task to move it, or accept as is. */
export function PlanDay({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [plan, setPlan] = useState<DayPlan>(() => buildDayPlan(data, new Date()));
  const [view, setView] = useState(() => viewOf(plan));
  const drag = useRef<{ id: string; y: number; start: number } | null>(null);
  const tasks = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const workAreas = useMemo(() => new Set(ctx.profile.areas.filter((a) => a.isWork).map((a) => a.id)), [ctx.profile.areas]);

  const move = (id: string, start: number) =>
    setPlan((p) => ({
      ...p,
      blocks: p.blocks.map((b) => {
        if (b.id !== id) return b;
        const len = b.end - b.start;
        const s = Math.max(view.start, Math.min(view.end - len, start));
        return { ...b, start: s, end: s + len };
      }),
    }));

  const remove = (b: Block) =>
    setPlan((p) => ({
      ...p,
      blocks: p.blocks.filter((x) => x.id !== b.id),
      unplaced: tasks.get(b.taskId!) ? [...p.unplaced, tasks.get(b.taskId!)!] : p.unplaced,
    }));

  // A task block clashes with anything else it overlaps (work hours only count for non-Work tasks).
  const clashes = useMemo(() => {
    const out = new Set<string>();
    for (const b of plan.blocks.filter((x) => x.kind === "task")) {
      const t = tasks.get(b.taskId!);
      const isWork = !!t?.area && workAreas.has(t.area);
      for (const o of plan.blocks) {
        if (o.id === b.id) continue;
        if (o.kind === "work" && isWork) continue;
        if (b.start < o.end && o.start < b.end) out.add(b.id);
      }
    }
    return out;
  }, [plan.blocks, tasks, workAreas]);

  const hours: number[] = [];
  for (let m = view.start; m <= view.end; m += 60) hours.push(m);
  const height = (view.end - view.start) * PPM;
  const placedCount = plan.blocks.filter((b) => b.kind === "task").length;

  const accept = () => {
    actions.applyPlan(plan.date, slotsFromPlan(plan));
    ctx.notify(
      placedCount
        ? ctx.profile.notify.slots
          ? "Plan saved. I'll nudge you as each block starts."
          : "Plan saved."
        : "Plan cleared.",
    );
    onClose();
  };
  const replan = () => {
    const next = buildDayPlan(data, new Date());
    setPlan(next);
    setView(viewOf(next));
    buzz(10);
  };

  return (
    <Sheet title="Plan my day" onClose={onClose}>
      <p className="-mt-1 mb-3 text-sm text-muted">
        Your fixed blocks are in. Tasks are slotted into the gaps by priority, due date and how long they take. Drag a task to move it.
      </p>

      <div className="relative ml-12 select-none" style={{ height }} role="list" aria-label="Today's timeline">
        {hours.map((m) => (
          <div key={m} className="absolute inset-x-0 border-t border-line/70" style={{ top: (m - view.start) * PPM }}>
            <span className="absolute -left-12 -top-2.5 w-10 text-right text-[11px] tabular-nums text-muted">{toHHMM(m)}</span>
          </div>
        ))}

        {upcoming(plan).map((b) => {
          const clash = clashes.has(b.id);
          const isTask = b.kind === "task";
          const h = Math.max(30, (b.end - b.start) * PPM - 2);
          const short = h < 46; // not enough room for two lines
          return (
            <div
              key={b.id}
              role="listitem"
              onPointerDown={(e) => {
                if (b.fixed || (e.target as HTMLElement).closest("button")) return;
                drag.current = { id: b.id, y: e.clientY, start: b.start };
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* not capturable: dragging still works while the pointer stays over the block */
                }
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== b.id) return;
                move(b.id, d.start + Math.round((e.clientY - d.y) / PPM / SNAP) * SNAP);
              }}
              onPointerUp={() => {
                if (drag.current?.id === b.id) buzz(8);
                drag.current = null;
              }}
              onPointerCancel={() => (drag.current = null)}
              className={`absolute inset-x-0 overflow-hidden rounded-xl px-2.5 py-1 text-xs ${KIND_STYLE[b.kind]} ${
                isTask ? "touch-none cursor-grab active:cursor-grabbing" : ""
              } ${clash ? "ring-2 ring-warn" : ""}`}
              style={{ top: (b.start - view.start) * PPM, height: h }}
            >
              <div className={`flex h-full gap-1.5 ${short ? "items-center" : "items-start"}`}>
                <div className={`min-w-0 flex-1 ${short ? "" : "pt-0.5"}`}>
                  <p className="truncate text-[13px] font-semibold leading-tight">
                    {KIND_EMOJI[b.kind]} {b.label}
                    {short && <span className="ml-1.5 font-normal opacity-80">{toHHMM(b.start)}–{toHHMM(b.end)}</span>}
                  </p>
                  {!short && (
                    <p className="truncate opacity-80">
                      {toHHMM(b.start)}–{toHHMM(b.end)}
                      {b.note ? ` · ${b.note}` : ""}
                      {clash ? " · overlaps" : ""}
                    </p>
                  )}
                </div>
                {isTask && (
                  <div className="flex shrink-0 items-center">
                    <button aria-label={`Move ${b.label} earlier`} onClick={() => move(b.id, b.start - SNAP)} className="flex h-8 w-8 items-center justify-center rounded-lg text-base">
                      ▲
                    </button>
                    <button aria-label={`Move ${b.label} later`} onClick={() => move(b.id, b.start + SNAP)} className="flex h-8 w-8 items-center justify-center rounded-lg text-base">
                      ▼
                    </button>
                    <button aria-label={`Take ${b.label} out of the plan`} onClick={() => remove(b)} className="flex h-8 w-8 items-center justify-center rounded-lg text-base">
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {placedCount === 0 && (
        <p className="mt-3 rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">
          {plan.unplaced.length
            ? "Nothing fits in what's left of today. Try a shorter task, or plan tomorrow."
            : "Nothing is due today. Add a task, or pull something in from Later."}
        </p>
      )}

      {plan.unplaced.length > 0 && placedCount > 0 && (
        <div className="mt-3 rounded-2xl bg-warn-soft p-3 text-sm">
          <p className="font-medium">Didn't fit today</p>
          <p className="text-xs text-ink">{plan.unplaced.map((t) => t.title).join(" · ")}</p>
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 mt-4 flex gap-2 border-t border-line bg-surface px-5 py-3">
        <button className={`${btn.primary} min-h-12 flex-1`} onClick={accept}>
          {placedCount ? "Accept plan" : "Done"}
        </button>
        <button className={`${btn.ghost} min-h-12`} onClick={replan}>
          Re-plan
        </button>
      </div>
    </Sheet>
  );
}
