"use client";
import { useEffect, useRef, useState } from "react";
import { friendlyDate } from "@/lib/dates";
import { toHHMM, toMin } from "@/lib/profile";
import type { Teach } from "@/lib/teach";
import { buildTimeline } from "@/lib/timeline";
import { whenDate } from "@/lib/snooze";
import { actions } from "@/lib/store";
import type { AppData, ISODate } from "@/lib/types";
import { Chip, type ViewCtx } from "./ui";

/** What a capture turned into. The card describes it and lets you fix it in one tap. */
export interface CaptureResult {
  id: number;
  kind: "task" | "event" | "grocery" | "session" | "paid" | "note";
  /** The headline: "Reply to starred email", "Power BI session 15"… */
  title: string;
  /** For things that aren't a task: the whole sentence ("Added Milk, Sugar to your shopping list"). */
  summary?: string;
  taskId?: string;
  /** What had to move to fit it ("Moved Power BI to 18:30 to fit “Fill form”."). */
  note?: string;
  /** A word the dictionary doesn't know: offer to teach it. */
  teach?: Teach;
  source: "rules" | "ai";
  undo: () => void;
  /** Opens the editor for an event. */
  edit?: () => void;
}

const soft = (s: string) => (/^(Today|Tomorrow|Yesterday)$/.test(s) ? s.toLowerCase() : s);
const whenText = (due: ISODate | undefined, time: string | undefined, today: ISODate) =>
  due ? `${soft(friendlyDate(due, today))}${time ? ` ${time}` : ""}` : "no date";

/** "Got it: Reply to starred email · Work · today 20:00". Tap the area or the time to fix them; it remembers. */
export function ConfirmCard({ result, data, ctx, onClose }: { result: CaptureResult; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [picker, setPicker] = useState<"area" | "time" | null>(null);
  const [fixed, setFixed] = useState(false);
  /** "Add to my dictionary?" has been answered. */
  const [taught, setTaught] = useState<"yes" | "no" | null>(null);
  const [pickTeach, setPickTeach] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Tidies itself away after a while, unless you're in the middle of fixing something.
  useEffect(() => {
    clearTimeout(timer.current);
    const open = picker || (result.teach && !taught);
    timer.current = setTimeout(onClose, open ? 25_000 : 12_000);
    return () => clearTimeout(timer.current);
  }, [result.id, picker, fixed, taught, result.teach, onClose]);

  const task = result.taskId ? data.tasks.find((t) => t.id === result.taskId) : undefined;
  const area = task?.area ? ctx.profile.areas.find((a) => a.id === task.area) : undefined;
  const p = ctx.profile;
  const afterWork = toHHMM(toMin(p.workEnd) + 15);
  // A task with no time of its own is placed in the best free gap: say where it landed.
  const placed = task && task.status === "open" && task.due && !task.dueTime ? buildTimeline(data, task.due, new Date()).items.find((x) => x.taskId === task.id) : undefined;
  const timeLabel = placed ? `${soft(friendlyDate(task!.due!, ctx.today))} · fits ${toHHMM(placed.start)}` : task ? whenText(task.due, task.dueTime, ctx.today) : "";

  const setArea = (id: string) => {
    if (!task) return;
    actions.update(task.id, { area: id });
    actions.learn(task.title, { areaId: id });
    setFixed(true);
    setPicker(null);
  };
  const setDay = (due: ISODate | undefined) => {
    if (!task) return;
    actions.update(task.id, due ? { due } : { due: undefined, dueTime: undefined });
    setFixed(true);
  };
  const setTime = (time: string | undefined) => {
    if (!task) return;
    actions.update(task.id, { dueTime: time, due: task.due ?? ctx.today });
    if (time) actions.learn(task.title, { time });
    setFixed(true);
    setPicker(null);
  };

  const teach = (areaId: string) => {
    if (!result.teach) return;
    actions.addUserWords(result.teach.words, areaId);
    if (task) actions.update(task.id, { area: areaId });
    setTaught("yes");
    setPickTeach(false);
  };
  const teachArea = result.teach?.suggested ? p.areas.find((a) => a.id === result.teach!.suggested) : undefined;

  const times: Array<[string, string | undefined]> = [
    ["Morning", "09:00"],
    ["Midday", "13:00"],
    ["After work", afterWork],
    ["Evening", "19:00"],
    ["Night", "21:00"],
    ["No time", undefined],
  ];
  const days: Array<[string, ISODate | undefined]> = [
    ["Today", ctx.today],
    ["Tomorrow", whenDate("tomorrow")],
    ["Weekend", whenDate("weekend")],
    ["No date", undefined],
  ];

  return (
    <div className="anim-fade mb-2 rounded-2xl border border-accent/30 bg-accent-soft p-3" role="status" aria-live="polite">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[15px] leading-snug">
          <span className="text-muted">Got it: </span>
          <span className="font-semibold">{result.summary ?? result.title}</span>
          {result.source === "ai" && <span className="ml-1.5 whitespace-nowrap rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-medium text-accent" title="Understood with Gemini">✨ Gemini</span>}
        </p>
        <button onClick={onClose} aria-label="Dismiss" className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted">
          ✕
        </button>
      </div>

      {result.note && <p className="mt-1.5 text-sm text-muted">{result.note}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task && (
          <>
            <button onClick={() => setPicker(picker === "area" ? null : "area")} aria-expanded={picker === "area"} className="min-h-9 rounded-full bg-surface px-3 text-sm font-medium shadow-sm">
              {area ? `${area.emoji} ${area.name}` : "📁 No area"} ▾
            </button>
            {result.kind !== "note" && (
              <button onClick={() => setPicker(picker === "time" ? null : "time")} aria-expanded={picker === "time"} className="min-h-9 rounded-full bg-surface px-3 text-sm font-medium shadow-sm">
                🕗 {timeLabel} ▾
              </button>
            )}
          </>
        )}
        {result.edit && (
          <button onClick={result.edit} className="min-h-9 rounded-full bg-surface px-3 text-sm font-medium shadow-sm">
            Edit
          </button>
        )}
        <button
          onClick={() => {
            result.undo();
            onClose();
          }}
          className="min-h-9 rounded-full px-3 text-sm font-medium text-muted"
        >
          ↩ Undo
        </button>
        {fixed && <Chip tone="accent">Updated. I'll remember that.</Chip>}
      </div>

      {result.teach && task && taught !== "no" && (
        <div className="mt-2 rounded-xl bg-surface p-2.5 text-sm" role="group" aria-label="Teach me">
          {taught === "yes" ? (
            <p className="font-medium text-accent">Added to my dictionary. I'll know “{result.teach.words.join(" ")}” next time, offline.</p>
          ) : (
            <>
              <p>
                New to me: <span className="font-semibold">“{result.teach.words.join(" ")}”</span>. {teachArea ? `It looks like ${teachArea.emoji} ${teachArea.name}. Add it to my dictionary?` : "Which area is it? I'll remember."}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {teachArea && !pickTeach && (
                  <>
                    <button onClick={() => teach(teachArea.id)} className="min-h-9 rounded-full bg-accent px-3.5 text-sm font-semibold text-accent-ink">
                      Yes, add it
                    </button>
                    <button onClick={() => setPickTeach(true)} className="min-h-9 rounded-full border border-line px-3 text-sm">
                      Other area
                    </button>
                  </>
                )}
                {(!teachArea || pickTeach) &&
                  p.areas.map((a) => (
                    <button key={a.id} onClick={() => teach(a.id)} className="min-h-9 rounded-full border border-line bg-bg px-3 text-sm">
                      {a.emoji} {a.name}
                    </button>
                  ))}
                <button onClick={() => setTaught("no")} className="min-h-9 rounded-full px-3 text-sm text-muted">
                  No thanks
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {picker === "area" && task && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="listbox" aria-label="Choose an area">
          {p.areas.map((a) => (
            <button
              key={a.id}
              role="option"
              aria-selected={a.id === task.area}
              onClick={() => setArea(a.id)}
              className={`min-h-9 rounded-full border px-3 text-sm ${a.id === task.area ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"}`}
            >
              {a.emoji} {a.name}
            </button>
          ))}
        </div>
      )}

      {picker === "time" && task && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {days.map(([label, d]) => (
              <button
                key={label}
                onClick={() => setDay(d)}
                className={`min-h-9 rounded-full border px-3 text-sm ${task.due === d ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {times.map(([label, t]) => (
              <button
                key={label}
                onClick={() => setTime(t)}
                className={`min-h-9 rounded-full border px-3 text-sm ${task.dueTime === t ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"}`}
              >
                {label}
                {t ? ` ${t}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
