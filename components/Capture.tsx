"use client";
import { useMemo, useState } from "react";
import { formatMinutes, friendlyDate } from "@/lib/dates";
import { parseCapture } from "@/lib/parse";
import { actions } from "@/lib/store";
import { TEMPLATES } from "@/lib/templates";
import type { ISODate } from "@/lib/types";
import { ArrowUpIcon } from "./icons";
import { Chip, type ViewCtx } from "./ui";

export function Capture({ ctx, defaultDate }: { ctx: ViewCtx; defaultDate?: ISODate }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseCapture(text) : null), [text]);
  const due = parsed ? (parsed.due ?? defaultDate) : undefined;

  const submit = () => {
    if (!parsed || !parsed.title) return;
    const task = actions.addTask(parsed, defaultDate);
    setText("");
    ctx.notify(
      task.due
        ? `Added for ${friendlyDate(task.due, ctx.today).toLowerCase()}${task.focus ? " and pinned to focus" : ""}`
        : "Added to Later",
    );
  };

  return (
    <div>
      {parsed && (
        <div className="anim-fade mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <Chip tone="accent">{due ? friendlyDate(due, ctx.today) + (parsed.dueTime ? ` · ${parsed.dueTime}` : "") : "→ Later"}</Chip>
          {parsed.important && <Chip tone="accent">! important</Chip>}
          {parsed.estimateMin && <Chip tone="accent">{formatMinutes(parsed.estimateMin)}</Chip>}
          {parsed.template && <Chip tone="accent">{TEMPLATES[parsed.template].emoji} {TEMPLATES[parsed.template].label}</Chip>}
          {parsed.tags.map((t) => (
            <Chip key={t} tone="accent">
              #{t}
            </Chip>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 rounded-2xl border border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-accent"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture anything… try “call mum Sunday !”"
          aria-label="Capture a task"
          enterKeyHint="done"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2 text-[16px] placeholder:text-muted/70 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!parsed}
          aria-label="Add task"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-ink transition disabled:opacity-30"
        >
          <ArrowUpIcon width={18} height={18} />
        </button>
      </form>
    </div>
  );
}
