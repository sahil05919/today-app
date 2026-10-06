"use client";
import { useState } from "react";
import { addDays, diffDays } from "@/lib/dates";
import type { AppData } from "@/lib/types";
import { TaskCard } from "./TaskCard";
import { Empty, SectionTitle, sortTasks, type ViewCtx } from "./ui";

export function LaterView({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const [tag, setTag] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = data.tasks.filter((t) => t.status === "open" && (!tag || t.tags.includes(tag)));
  const someday = sortTasks(open.filter((t) => !t.due));
  const furtherOut = sortTasks(open.filter((t) => t.due && diffDays(t.due, addDays(ctx.today, 6)) > 0));
  const done = data.tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 20);
  const allTags = [...new Set(data.tasks.filter((t) => t.status === "open").flatMap((t) => t.tags))].sort();

  return (
    <div>
      {allTags.length > 0 && (
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                tag === t ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      <SectionTitle right={someday.length}>Someday</SectionTitle>
      {someday.length ? (
        <div className="space-y-2">
          {someday.map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} quickToday />
          ))}
        </div>
      ) : (
        <Empty>Anything you capture without a date lands here, calmly waiting.</Empty>
      )}

      {furtherOut.length > 0 && (
        <>
          <SectionTitle right={furtherOut.length}>Further out</SectionTitle>
          <div className="space-y-2">
            {furtherOut.map((t) => (
              <TaskCard key={t.id} task={t} ctx={ctx} />
            ))}
          </div>
        </>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle
            right={
              <button onClick={() => setShowDone((s) => !s)} className="underline-offset-2 hover:underline">
                {showDone ? "Hide" : "Show"}
              </button>
            }
          >
            Recently done
          </SectionTitle>
          {showDone && (
            <div className="space-y-2">
              {done.map((t) => (
                <TaskCard key={t.id} task={t} ctx={ctx} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
