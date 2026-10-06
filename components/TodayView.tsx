"use client";
import { useState } from "react";
import { backupDue, exportBackup } from "@/lib/backup";
import { diffDays, toISO } from "@/lib/dates";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { TaskCard } from "./TaskCard";
import { btn, Empty, SectionTitle, sortTasks, type ViewCtx } from "./ui";

export function TodayView({ data, ctx, onRescue }: { data: AppData; ctx: ViewCtx; onRescue: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const open = data.tasks.filter((t) => t.status === "open");
  const focus = sortTasks(open.filter((t) => t.focus));
  const dueNow = sortTasks(open.filter((t) => !t.focus && t.due != null && diffDays(t.due, ctx.today) <= 0));
  const doneToday = data.tasks
    .filter((t) => t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) === ctx.today)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const showBackup = backupDue(data);

  return (
    <div>
      {showBackup && (
        <div className="mb-2 rounded-2xl bg-warn-soft p-4 text-sm">
          <p className="font-medium text-ink">A gentle nudge: it's been a couple of weeks since your last backup.</p>
          <p className="mt-0.5 text-muted">Your tasks only live on this device, so a quick export keeps them safe.</p>
          <div className="mt-3 flex gap-2">
            <button
              className={btn.primary}
              onClick={() => {
                exportBackup(data);
                actions.settings({ lastBackupAt: Date.now() });
                ctx.notify("Backup downloaded. Thank you!");
              }}
            >
              Back up now
            </button>
            <button className={btn.ghost} onClick={() => actions.settings({ backupSnoozedUntil: Date.now() + 3 * 86_400_000 })}>
              Remind me later
            </button>
          </div>
        </div>
      )}

      <SectionTitle right={`${focus.length}/${MAX_FOCUS}`}>Your focus</SectionTitle>
      {focus.length ? (
        <div className="space-y-2.5">
          {focus.map((t) => (
            <TaskCard key={t.id} task={t} ctx={ctx} big />
          ))}
        </div>
      ) : (
        <Empty>
          {open.length || doneToday.length
            ? "Nothing pinned yet. Tap the target on up to three things that would make today a good day."
            : "A clear page. Type something below to get started. Dates, ! and #tags are understood."}
        </Empty>
      )}

      {dueNow.length > 0 && (
        <>
          <SectionTitle>Due or slipped</SectionTitle>
          <div className="space-y-2">
            {dueNow.map((t) => (
              <TaskCard key={t.id} task={t} ctx={ctx} />
            ))}
          </div>
        </>
      )}

      {open.length > 0 && (
        <div className="mt-6 text-center">
          <button onClick={onRescue} className={btn.soft}>
            Short on time? Rescue my day
          </button>
        </div>
      )}

      {doneToday.length > 0 && (
        <>
          <SectionTitle
            right={
              <button onClick={() => setShowDone((s) => !s)} className="underline-offset-2 hover:underline">
                {showDone ? "Hide" : "Show"}
              </button>
            }
          >
            Done today · {doneToday.length}
          </SectionTitle>
          {showDone ? (
            <div className="space-y-2">
              {doneToday.map((t) => (
                <TaskCard key={t.id} task={t} ctx={ctx} />
              ))}
            </div>
          ) : (
            <p className="px-1 text-sm text-muted">Nice work. {doneToday.length === 1 ? "One thing" : `${doneToday.length} things`} off your plate.</p>
          )}
        </>
      )}
    </div>
  );
}
