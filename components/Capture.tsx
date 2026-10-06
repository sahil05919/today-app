"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { friendlyDate } from "@/lib/dates";
import { parseCapture } from "@/lib/parse";
import { voiceSupported } from "@/lib/voice";
import { actions } from "@/lib/store";
import type { ISODate } from "@/lib/types";
import { ArrowUpIcon, MicIcon } from "./icons";
import { ParsePreview } from "./ParsePreview";
import { type ViewCtx } from "./ui";
import { VoicePanel } from "./VoicePanel";

/** Sent from outside (share target, app shortcuts) to drive the capture bar. */
export interface CaptureCommand {
  kind: "new" | "voice" | "prefill";
  text?: string;
  nonce: number;
}

export function Capture({
  ctx,
  defaultDate,
  command,
}: {
  ctx: ViewCtx;
  defaultDate?: ISODate;
  command?: CaptureCommand;
}) {
  const [text, setText] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseCapture(text, new Date(), ctx.profile) : null), [text, ctx.profile]);

  // The mic only exists where voice can work: a supporting browser, and a connection (Chrome's voice is online).
  useEffect(() => {
    const update = () => setVoiceOk(voiceSupported(navigator.onLine));
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!command) return;
    if (command.kind === "voice") {
      if (voiceSupported(navigator.onLine)) {
        setAutoStart(true);
        setVoiceOpen(true);
      } else input.current?.focus();
    } else {
      if (command.kind === "prefill") setText(command.text ?? "");
      input.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.nonce]);

  const save = (value: string) => {
    const p = parseCapture(value, new Date(), ctx.profile);
    if (!p.title) return;
    const task = actions.addTask(p, defaultDate);
    ctx.notify(
      task.due
        ? `Added for ${friendlyDate(task.due, ctx.today).toLowerCase()}${task.focus ? " and pinned to focus" : ""}`
        : "Added to Later. Tap “Set date” there when you know.",
    );
  };

  return (
    <div>
      {voiceOpen && voiceOk && (
        <VoicePanel
          today={ctx.today}
          profile={ctx.profile}
          defaultDate={defaultDate}
          autoStart={autoStart}
          onClose={() => {
            setVoiceOpen(false);
            setAutoStart(false);
          }}
          onSave={(t) => {
            save(t);
            setVoiceOpen(false);
            setAutoStart(false);
          }}
          onEdit={(t) => {
            setText(t);
            setVoiceOpen(false);
            setAutoStart(false);
            input.current?.focus();
          }}
        />
      )}
      {parsed && !voiceOpen && (
        <div className="mb-2">
          <ParsePreview parsed={parsed} today={ctx.today} defaultDate={defaultDate} areas={ctx.profile.areas} />
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed) return;
          save(text);
          setText("");
        }}
        className="flex items-center gap-1.5 rounded-2xl border border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-accent"
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture anything… try “kal 6 baje call mum !”"
          aria-label="Capture a task"
          enterKeyHint="done"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] placeholder:text-muted/70 focus:outline-none"
        />
        {voiceOk && !text && (
          <button
            type="button"
            onClick={() => {
              setAutoStart(false);
              setVoiceOpen((o) => !o);
            }}
            aria-label="Speak a task"
            aria-pressed={voiceOpen}
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${voiceOpen ? "bg-accent-soft text-accent" : "text-muted"}`}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="submit"
          disabled={!parsed}
          aria-label="Add task"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-ink transition disabled:opacity-30"
        >
          <ArrowUpIcon width={20} height={20} />
        </button>
      </form>
    </div>
  );
}
