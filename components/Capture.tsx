"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiEnabled, needsAi, smartParse } from "@/lib/ai";
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
/** "Today" reads well in a sentence as "today"; "Sat 10 Oct" stays as it is. */
const soft = (s: string) => (/^(Today|Tomorrow|Yesterday)$/.test(s) ? s.toLowerCase() : s);

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
  const [busy, setBusy] = useState(false);
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

  const save = async (value: string) => {
    const rules = parseCapture(value, new Date(), ctx.profile);
    if (!rules.title) return;

    // Rules do the work. If you've added a Gemini key and the rules are unsure, it fills the gaps;
    // offline, or on any problem, the rules' answer stands.
    let p = rules;
    if (aiEnabled() && needsAi(rules, value)) {
      setBusy(true);
      const r = await smartParse(value, rules, ctx.profile.areas, ctx.today);
      setBusy(false);
      p = r.parsed;
      if (r.reason === "bad-key") ctx.notify("Gemini didn't accept the key, so I used the built-in rules.");
      else if (r.reason === "rate-limit") ctx.notify("Gemini's free limit is reached for now. Used the built-in rules.");
    }

    if (p.kind === "grocery") {
      const n = actions.addGrocery(p.groceryItems ?? []);
      ctx.notify(n ? `Added ${n} to your shopping list` : "Already on your list");
    } else if (p.kind === "event") {
      const e = actions.addEvent(p);
      ctx.notify(
        `Event added for ${soft(friendlyDate(e.date, ctx.today))}${e.start ? ` at ${e.start}` : ""}. Sessions will move around it.`,
        () => actions.removeEvent(e.id),
      );
    } else {
      const task = actions.addTask(p, defaultDate);
      ctx.notify(
        task.due
          ? `Added for ${soft(friendlyDate(task.due, ctx.today))}${task.focus ? " and pinned to focus" : ""}`
          : "Added to Later. Tap “Set date” there when you know.",
      );
    }
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
          const value = text;
          setText("");
          void save(value);
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
          aria-label="Add"
          aria-busy={busy}
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-ink transition disabled:opacity-30 ${busy ? "animate-pulse" : ""}`}
        >
          <ArrowUpIcon width={20} height={20} />
        </button>
      </form>
    </div>
  );
}
