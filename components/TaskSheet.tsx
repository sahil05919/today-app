"use client";
import { useState } from "react";
import { formatMinutes, fromISO } from "@/lib/dates";
import { recurLabel } from "@/lib/recur";
import type { Recurrence } from "@/lib/types";
import { remainingMinutes, stepProgress } from "@/lib/estimate";
import { actualMinutes } from "@/lib/stats";
import { downloadICS, googleCalendarUrl } from "@/lib/ics";
import { extractEstimate } from "@/lib/parse";
import { actions } from "@/lib/store";
import { TEMPLATE_LIST } from "@/lib/templates";
import type { Task } from "@/lib/types";
import { MAX_FOCUS } from "@/lib/types";
import { CheckIcon, CloseIcon, TrashIcon } from "./icons";
import { completeWithToast } from "./TaskCard";
import { btn, field, Sheet, type ViewCtx } from "./ui";

function recurKey(r?: Recurrence): string {
  if (!r) return "none";
  const wd = r.weekdays ?? [];
  if (r.interval !== 1) return "custom";
  if (r.freq === "daily") return "daily";
  if (r.freq === "monthly") return "monthly";
  if (wd.length === 5 && [1, 2, 3, 4, 5].every((d) => wd.includes(d))) return "weekdays";
  return wd.length > 1 ? "custom" : "weekly";
}

function buildRecur(key: string, anchor: string): Recurrence | undefined {
  const d = fromISO(anchor);
  if (key === "daily") return { freq: "daily", interval: 1 };
  if (key === "weekdays") return { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] };
  if (key === "weekly") return { freq: "weekly", interval: 1, weekdays: [d.getDay()] };
  if (key === "monthly") return { freq: "monthly", interval: 1, monthDay: d.getDate() };
  return undefined;
}

export function TaskSheet({ task, ctx, onClose, timerOn = false }: { task: Task; ctx: ViewCtx; onClose: () => void; timerOn?: boolean }) {
  const [stepText, setStepText] = useState("");
  const [tagsText, setTagsText] = useState(task.tags.map((t) => `#${t}`).join(" "));
  const prog = stepProgress(task);
  const rem = remainingMinutes(task);

  const addStep = () => {
    const { text, estimateMin } = extractEstimate(` ${stepText} `);
    const title = text.trim();
    if (!title) return;
    actions.addStep(task.id, title, estimateMin);
    setStepText("");
  };

  const commitTags = () => {
    const tags = [...new Set(tagsText.split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean))];
    actions.update(task.id, { tags });
    setTagsText(tags.map((t) => `#${t}`).join(" "));
  };

  const label = "mb-1 block text-xs font-medium text-muted";

  return (
    <Sheet title="Task" onClose={onClose}>
      <div className="space-y-5">
        <input
          value={task.title}
          onChange={(e) => actions.update(task.id, { title: e.target.value })}
          aria-label="Title"
          className={`${field} text-lg font-semibold`}
        />

        <div className="flex gap-2">
          <button
            onClick={() => {
              completeWithToast(task, ctx);
              onClose();
            }}
            className={`${task.status === "done" ? btn.ghost : btn.primary} flex flex-1 items-center justify-center gap-1.5`}
          >
            <CheckIcon width={16} height={16} /> {task.status === "done" ? "Reopen" : "Mark done"}
          </button>
          {task.status === "open" && (
            <button
              onClick={() => {
                onClose();
                ctx.when(task.id, "snooze");
              }}
              className={`${btn.ghost} px-4`}
            >
              Snooze
            </button>
          )}
          {task.status === "open" && (
            <button
              onClick={() => {
                if (!actions.toggleFocus(task.id)) ctx.notify(`Focus holds ${MAX_FOCUS} things. Un-pin one first.`);
              }}
              className={`${task.focus ? btn.soft : btn.ghost} flex-1`}
              aria-pressed={task.focus}
            >
              {task.focus ? "In your focus" : "Add to focus"}
            </button>
          )}
        </div>

        {task.status === "open" && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Focus timer</p>
              <p className="text-xs text-muted">
                {actualMinutes(task) > 0
                  ? `${formatMinutes(actualMinutes(task))} logged over ${task.sessions?.length} session${task.sessions?.length === 1 ? "" : "s"}`
                  : "Time it, and Rescue learns how long things take you."}
              </p>
            </div>
            {timerOn ? (
              <button
                className={`${btn.primary} min-h-11`}
                onClick={() => {
                  const l = actions.stopTimer();
                  if (l) ctx.notify(`Logged ${l.minutes} min`);
                }}
              >
                Stop
              </button>
            ) : (
              <button
                className={`${btn.soft} min-h-11`}
                onClick={() => {
                  actions.startTimer(task.id);
                  ctx.notify("Timer running. Go for it.");
                  onClose();
                }}
              >
                ▶ Start
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="due">
              Date
            </label>
            <input
              id="due"
              type="date"
              value={task.due ?? ""}
              onChange={(e) => actions.setDue(task.id, e.target.value || undefined, task.dueTime)}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="time">
              Time (optional)
            </label>
            <input
              id="time"
              type="time"
              disabled={!task.due}
              value={task.dueTime ?? ""}
              onChange={(e) => actions.update(task.id, { dueTime: e.target.value || undefined })}
              className={`${field} disabled:opacity-40`}
            />
          </div>
          <div>
            <label className={label} htmlFor="est">
              Estimate (minutes)
            </label>
            <input
              id="est"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder={task.steps.length ? "from steps" : "auto"}
              value={task.estimateMin ?? ""}
              onChange={(e) => actions.update(task.id, { estimateMin: e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : undefined })}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="tags">
              Tags
            </label>
            <input
              id="tags"
              value={tagsText}
              placeholder="#home #money"
              onChange={(e) => setTagsText(e.target.value)}
              onBlur={commitTags}
              className={field}
            />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="area">
            Life area
          </label>
          <select
            id="area"
            value={task.area && ctx.profile.areas.some((a) => a.id === task.area) ? task.area : ""}
            onChange={(e) => actions.update(task.id, { area: e.target.value || undefined })}
            className={field}
          >
            <option value="">No area</option>
            {ctx.profile.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="repeat">
            Repeat
          </label>
          <select
            id="repeat"
            value={recurKey(task.recur)}
            onChange={(e) => actions.update(task.id, { recur: buildRecur(e.target.value, task.due ?? ctx.today) ?? (e.target.value === "custom" ? task.recur : undefined) })}
            className={field}
          >
            <option value="none">Doesn't repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays (Mon–Fri)</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            {task.recur && recurKey(task.recur) === "custom" && <option value="custom">{recurLabel(task.recur)}</option>}
          </select>
          {task.recur && <p className="mt-1 text-xs text-muted">Finishing it creates the next one automatically.</p>}
        </div>

        <label className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
          <span className="font-medium">Important</span>
          <input
            type="checkbox"
            checked={task.important}
            onChange={(e) => actions.update(task.id, { important: e.target.checked })}
            className="h-5 w-5 accent-[var(--accent)]"
          />
        </label>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Steps</h3>
            <span className="text-xs text-muted">
              {prog.total ? `${prog.done}/${prog.total} done · ` : ""}
              {task.status === "open" ? `${rem.guessed ? "about " : ""}${formatMinutes(rem.minutes)} left` : ""}
            </span>
          </div>
          {prog.total > 0 && (
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${prog.pct}%` }} />
            </div>
          )}
          <ul className="space-y-1">
            {task.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
                <button
                  onClick={() => actions.toggleStep(task.id, s.id)}
                  aria-label={s.done ? "Mark step not done" : "Mark step done"}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    s.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"
                  }`}
                >
                  <CheckIcon width={11} height={11} />
                </button>
                <span className={`flex-1 text-[15px] ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                {s.estimateMin != null && <span className="text-xs text-muted">{formatMinutes(s.estimateMin)}</span>}
                <button onClick={() => actions.removeStep(task.id, s.id)} aria-label="Remove step" className="rounded-full p-1 text-muted/60 hover:text-ink">
                  <CloseIcon width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addStep();
            }}
          >
            <input value={stepText} onChange={(e) => setStepText(e.target.value)} placeholder="Add a step… (~15m optional)" className={field} />
            <button type="submit" disabled={!stepText.trim()} className={btn.soft}>
              Add
            </button>
          </form>

          <p className="mb-1.5 mt-4 text-xs font-medium text-muted">Start from a template</p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_LIST.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  actions.applyTemplate(task.id, t.id);
                  ctx.notify(`Added ${t.label.toLowerCase()} steps`);
                }}
                className="rounded-full border border-line bg-bg px-3 py-1.5 text-xs font-medium text-ink"
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </section>

        <div>
          <label className={label} htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            value={task.notes ?? ""}
            onChange={(e) => actions.update(task.id, { notes: e.target.value || undefined })}
            className={field}
          />
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Reminders on your phone</h3>
          {task.due ? (
            <div className="flex gap-2">
              <button className={`${btn.ghost} flex-1`} onClick={() => downloadICS(task)}>
                Download .ics
              </button>
              <a className={`${btn.ghost} flex-1 text-center`} href={googleCalendarUrl(task)} target="_blank" rel="noopener noreferrer">
                Google Calendar
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted">Give this task a date to add it to your calendar.</p>
          )}
        </section>

        <button
          onClick={() => {
            if (confirm(`Delete “${task.title}”? This can't be undone.`)) {
              actions.remove(task.id);
              onClose();
            }
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium text-warn"
        >
          <TrashIcon width={16} height={16} /> Delete task
        </button>
      </div>
    </Sheet>
  );
}
