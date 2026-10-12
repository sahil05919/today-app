"use client";
import { useState } from "react";
import { recurLabel } from "@/lib/recur";
import { actions } from "@/lib/store";
import type { Recurrence, Series } from "@/lib/types";
import { RepeatEditor } from "./RepeatEditor";
import { btn, field, type ViewCtx } from "./ui";

/** Settings → Repeating tasks: every series (title, rule, time) with edit and delete. One series is one repeating task. */
export function RepeatingTasks({ series, ctx }: { series: Series[]; ctx: ViewCtx }) {
  const [editing, setEditing] = useState<string | null>(null);
  const live = series.filter((s) => !s.until || s.until >= ctx.today);
  const ended = series.length - live.length;

  if (!live.length) return <p className="text-sm text-muted">Nothing repeats yet. Type “every Monday …” or “daily …” to make one.</p>;

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {live.map((s) => (
          <li key={s.id} className="rounded-2xl bg-bg p-3">
            {editing === s.id ? (
              <SeriesForm s={s} onDone={() => setEditing(null)} ctx={ctx} />
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[15px] font-medium ${s.off ? "text-muted line-through" : ""}`}>{s.title}</p>
                  <p className="text-xs text-muted">
                    {recurLabel(s.rule)} · {s.time ? s.time : "any time"}
                    {s.off ? " · off" : ""}
                  </p>
                </div>
                <button type="button" className={`${btn.ghost} min-h-10 px-3`} onClick={() => setEditing(s.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="min-h-10 px-2 text-sm text-warn"
                  aria-label={`Delete ${s.title}`}
                  onClick={() => {
                    const undo = actions.deleteSeries(s.id);
                    ctx.notify(`Deleted “${s.title}”`, undo);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {ended > 0 && <p className="text-xs text-muted">{ended} ended {ended === 1 ? "repeat is" : "repeats are"} kept for the history.</p>}
    </div>
  );
}

function SeriesForm({ s, onDone, ctx }: { s: Series; onDone: () => void; ctx: ViewCtx }) {
  const [title, setTitle] = useState(s.title);
  const [time, setTime] = useState(s.time ?? "");
  const [rule, setRule] = useState<Recurrence>(s.rule);
  return (
    <div className="space-y-2.5">
      <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 300))} aria-label="Title" className={field} />
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">At</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className={`${field} w-32`} />
        {time && (
          <button type="button" className="text-sm text-muted underline" onClick={() => setTime("")}>
            no fixed time
          </button>
        )}
      </label>
      <RepeatEditor rule={rule} anchor={s.startDate} onChange={(r) => r && setRule(r)} />
      <div className="flex gap-2">
        <button
          type="button"
          className={`${btn.primary} min-h-10`}
          disabled={!title.trim()}
          onClick={() => {
            actions.updateSeries(s.id, { title: title.trim(), time: time || null, rule });
            ctx.notify("Saved");
            onDone();
          }}
        >
          Save
        </button>
        <button type="button" className={`${btn.ghost} min-h-10`} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
