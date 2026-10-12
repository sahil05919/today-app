"use client";
import { useState } from "react";
import { formatMinutes, fromISO } from "@/lib/dates";
import { recurLabel } from "@/lib/recur";
import type { SeriesPatch } from "@/lib/series";
import { remainingMinutes, stepProgress } from "@/lib/estimate";
import { actualMinutes } from "@/lib/stats";
import { downloadICS, googleCalendarUrl } from "@/lib/ics";
import { extractEstimate } from "@/lib/parse";
import { actions } from "@/lib/store";
import { TEMPLATES, TEMPLATE_LIST } from "@/lib/templates";
import type { Task } from "@/lib/types";
import { CheckIcon, CloseIcon, TrashIcon } from "./icons";
import { RepeatEditor } from "./RepeatEditor";
import { completeWithToast } from "./TaskCard";
import { btn, field, Sheet, type ViewCtx } from "./ui";

/** The unsaved edits of a repeating task, shown on top of the stored occurrence. */
function patchToTask(p: SeriesPatch): Partial<Task> {
  const out: Partial<Task> = {};
  if (p.title !== undefined) out.title = p.title;
  if (p.notes !== undefined) out.notes = p.notes || undefined;
  if (p.time !== undefined) out.dueTime = p.time ?? undefined;
  if (p.estimateMin !== undefined) out.estimateMin = p.estimateMin || undefined;
  if (p.area !== undefined) out.area = p.area || undefined;
  if (p.tags !== undefined) out.tags = p.tags;
  if (p.important !== undefined) out.important = p.important;
  if (p.steps !== undefined) out.steps = p.steps;
  if (p.rule !== undefined) out.recur = p.rule ?? undefined;
  return out;
}

/** A change to the task view, as a change to the series. */
function taskToPatch(p: Partial<Task>): SeriesPatch {
  const out: SeriesPatch = {};
  if ("title" in p) out.title = p.title ?? "";
  if ("notes" in p) out.notes = p.notes ?? "";
  if ("dueTime" in p) out.time = p.dueTime ?? null;
  if ("estimateMin" in p) out.estimateMin = p.estimateMin ?? 0;
  if ("area" in p) out.area = p.area ?? "";
  if ("tags" in p) out.tags = p.tags;
  if ("important" in p) out.important = p.important;
  if ("steps" in p) out.steps = p.steps;
  return out;
}

export function TaskSheet({ task: live, ctx, onClose, timerOn = false }: { task: Task; ctx: ViewCtx; onClose: () => void; timerOn?: boolean }) {
  const isSeries = !!live.seriesId;
  /** Repeats: edits wait here until you say whether they are for this one only or this and future. */
  const [draft, setDraft] = useState<SeriesPatch>({});
  const dirty = Object.keys(draft).length > 0;
  const task: Task = isSeries ? { ...live, ...patchToTask(draft) } : live;
  const edit = (p: Partial<Task>) => (isSeries ? setDraft((d) => ({ ...d, ...taskToPatch(p) })) : actions.update(live.id, p));
  const [stepText, setStepText] = useState("");
  const [tagsText, setTagsText] = useState(task.tags.map((t) => `#${t}`).join(" "));
  const prog = stepProgress(task);
  const rem = remainingMinutes(task);

  const addStep = () => {
    const { text, estimateMin } = extractEstimate(` ${stepText} `);
    const title = text.trim();
    if (!title) return;
    if (isSeries) edit({ steps: [...task.steps, { id: crypto.randomUUID(), title, done: false, estimateMin }] });
    else actions.addStep(task.id, title, estimateMin);
    setStepText("");
  };

  const commitTags = () => {
    const tags = [...new Set(tagsText.split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean))];
    edit({ tags });
    setTagsText(tags.map((t) => `#${t}`).join(" "));
  };

  const save = (scope: "this" | "future") => {
    const id = actions.editRepeating(live.id, draft, scope);
    setDraft({});
    ctx.notify(draft.rule === null ? "Stopped repeating from this day" : scope === "future" ? "Updated this and every later one" : "Updated this one only");
    if (id !== live.id) ctx.open(id);
  };

  const label = "mb-1 block text-xs font-medium text-muted";

  return (
    <Sheet title="Task" onClose={onClose}>
      <div className="space-y-5">
        <input
          value={task.title}
          onChange={(e) => edit({ title: e.target.value })}
          aria-label="Title"
          className={`${field} text-lg font-semibold`}
        />

        {isSeries && task.recur && (
          <p className="-mt-3 text-sm text-muted">
            ↻ {recurLabel(task.recur)}
            {task.dueTime ? ` · ${task.dueTime}` : ""}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => {
              completeWithToast(live, ctx);
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
        </div>

        {task.status === "open" && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Focus timer</p>
              <p className="text-xs text-muted">
                {actualMinutes(task) > 0
                  ? `${formatMinutes(actualMinutes(task))} logged over ${task.sessions?.length} session${task.sessions?.length === 1 ? "" : "s"}`
                  : "Time it, and Today learns how long things really take you."}
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
              onChange={(e) => actions.setDue(live.id, e.target.value || undefined, live.dueTime)}
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
              onChange={(e) => edit({ dueTime: e.target.value || undefined })}
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
              onChange={(e) => edit({ estimateMin: e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : undefined })}
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
            onChange={(e) => edit({ area: e.target.value || undefined })}
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
          <RepeatEditor
            rule={task.recur}
            anchor={live.occDate ?? live.due ?? ctx.today}
            onChange={(r) => {
              if (isSeries) setDraft((d) => ({ ...d, rule: r }));
              else if (r) {
                const id = actions.makeRepeating(live.id, r);
                if (id) {
                  ctx.open(id);
                  ctx.notify("Now it repeats");
                }
              }
            }}
          />
          {isSeries && !dirty && <p className="mt-1 text-xs text-muted">Each day is its own: ticking one never touches the others.</p>}
        </div>

        <label className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
          <span className="font-medium">Important</span>
          <input
            type="checkbox"
            checked={task.important}
            onChange={(e) => edit({ important: e.target.checked })}
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
                  onClick={() => (draft.steps ? edit({ steps: task.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) }) : actions.toggleStep(live.id, s.id))}
                  aria-label={s.done ? "Mark step not done" : "Mark step done"}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    s.done ? "border-accent bg-accent text-accent-ink" : "border-muted/40 text-transparent"
                  }`}
                >
                  <CheckIcon width={11} height={11} />
                </button>
                <span className={`flex-1 text-[15px] ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                {s.estimateMin != null && <span className="text-xs text-muted">{formatMinutes(s.estimateMin)}</span>}
                <button onClick={() => (isSeries ? edit({ steps: task.steps.filter((x) => x.id !== s.id) }) : actions.removeStep(live.id, s.id))} aria-label="Remove step" className="rounded-full p-1 text-muted/60 hover:text-ink">
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
                  if (isSeries) {
                    const have = new Set(task.steps.map((x) => x.title));
                    edit({ steps: [...task.steps, ...TEMPLATES[t.id].steps.filter((x) => !have.has(x.title)).map((x) => ({ id: crypto.randomUUID(), title: x.title, done: false, estimateMin: x.estimateMin }))] });
                  } else actions.applyTemplate(task.id, t.id);
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
            onChange={(e) => edit({ notes: e.target.value || undefined })}
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

        {isSeries ? (
          <div className="space-y-1">
            <button
              onClick={() => {
                actions.skipOccurrence(live.id);
                ctx.notify("Skipped this one", () => actions.skipOccurrence(live.id, false));
                onClose();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium text-muted"
            >
              Skip just this one
            </button>
            <button
              onClick={() => {
                if (confirm(`Stop “${task.title}” repeating from this day on? Days already done stay in your history.`)) {
                  const snap = actions.endRepeating(live.id);
                  ctx.notify("Stopped repeating", () => actions.restoreRepeating(snap));
                  onClose();
                }
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium text-warn"
            >
              <TrashIcon width={16} height={16} /> Delete this and future
            </button>
          </div>
        ) : (
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
        )}

        {dirty && (
          <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-line bg-surface px-5 pb-1 pt-3" role="group" aria-label="Save changes to a repeating task">
            <p className="text-sm font-medium">{draft.rule !== undefined ? "Change how it repeats from this day on?" : "Apply these changes to…"}</p>
            <div className="flex gap-2">
              {draft.rule === undefined && (
                <button className={`${btn.ghost} min-h-12 flex-1`} onClick={() => save("this")}>
                  This one only
                </button>
              )}
              <button className={`${btn.primary} min-h-12 flex-1`} onClick={() => save("future")}>
                This and future
              </button>
            </div>
            <button className={btn.link} onClick={() => setDraft({})}>
              Discard changes
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
