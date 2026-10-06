"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiEnabled, interpret } from "@/lib/ai";
import { nextDue } from "@/lib/bills";
import { friendlyDate } from "@/lib/dates";
import type { ParsedCapture } from "@/lib/parse";
import { sessionTitle } from "@/lib/sessions";
import { actions, getData } from "@/lib/store";
import { understand } from "@/lib/understand";
import { voiceSupported } from "@/lib/voice";
import type { AppData, FixedEvent, ISODate } from "@/lib/types";
import { ConfirmCard, type CaptureResult } from "./ConfirmCard";
import { ArrowUpIcon, MicIcon } from "./icons";
import { ParsePreview } from "./ParsePreview";
import { EventSheet } from "./TodayPlan";
import { type ViewCtx } from "./ui";
import { VoicePanel } from "./VoicePanel";

/** Sent from outside (share target, app shortcuts) to drive the capture bar. */
export interface CaptureCommand {
  kind: "new" | "voice" | "prefill";
  text?: string;
  nonce: number;
}

const soft = (s: string) => (/^(Today|Tomorrow|Yesterday)$/.test(s) ? s.toLowerCase() : s);

export function Capture({
  ctx,
  data,
  defaultDate,
  command,
}: {
  ctx: ViewCtx;
  data: AppData;
  defaultDate?: ISODate;
  command?: CaptureCommand;
}) {
  const [text, setText] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [editing, setEditing] = useState<FixedEvent | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Live preview: the same pipeline that runs on Enter (rules, your learned fixes, a sensible time).
  const parsed = useMemo(() => (text.trim() ? understand(text, data, new Date()) : null), [text, data]);

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

  /** Does what the capture means, and says what it did. */
  const perform = (p: ParsedCapture): CaptureResult | null => {
    const id = ++seq.current;
    const source = p.source ?? "rules";
    const d = getData();
    const areas = ctx.profile.areas;

    if (p.kind === "session" && p.session) {
      const area = areas.find((a) => a.id === p.session!.areaId);
      if (!area) return null;
      const { areaId, date } = p.session;
      if (d.sessions?.some((l) => l.areaId === areaId && l.date === date)) {
        return { id, kind: "session", title: area.name, summary: `${area.name} is already counted ${soft(friendlyDate(date, ctx.today))}`, source, undo: () => {} };
      }
      const log = actions.toggleSession(areaId, date, "manual");
      if (!log) return null;
      const title = sessionTitle(area, log.n, log.variant);
      return { id, kind: "session", title, summary: `Counted ${title}`, source, undo: () => actions.toggleSession(areaId, date, "manual") };
    }

    if (p.kind === "paid" && p.paidBillId) {
      const bill = d.bills?.find((b) => b.id === p.paidBillId);
      if (!bill) return null;
      const due = nextDue(bill, ctx.today) ?? ctx.today;
      const prev = bill.lastDone;
      actions.completeBill(bill.id, due);
      return { id, kind: "paid", title: bill.name, summary: `Marked ${bill.name} as paid`, source, undo: () => actions.uncompleteBill(bill.id, due, prev) };
    }

    if (p.kind === "grocery") {
      const items = p.groceryItems ?? [];
      const ids = actions.addGrocery(items);
      return {
        id,
        kind: "grocery",
        title: items.join(", "),
        summary: ids.length ? `${items.join(", ")} added to your shopping list` : "Already on your shopping list",
        source,
        undo: () => ids.forEach((g) => actions.removeGrocery(g)),
      };
    }

    if (p.kind === "event") {
      const e = actions.addEvent(p);
      const when = `${soft(friendlyDate(e.date, ctx.today))}${e.start ? ` ${e.start}${e.end ? "–" + e.end : ""}` : " (all day)"}`;
      return {
        id,
        kind: "event",
        title: e.title,
        summary: `${e.title}, ${when}. Sessions will move around it`,
        source,
        undo: () => actions.removeEvent(e.id),
        edit: () => setEditing(getData().events?.find((x) => x.id === e.id) ?? e),
      };
    }

    // task, reminder, chore, note
    const task = actions.addTask(p, p.kind === "note" ? undefined : defaultDate);
    const area = areas.find((a) => a.id === task.area);
    return {
      id,
      kind: p.kind === "note" ? "note" : "task",
      title: task.title,
      summary: p.kind === "note" ? `Saved to ${area?.name ?? "notes"}: ${task.title}` : undefined,
      taskId: task.id,
      source,
      undo: () => actions.remove(task.id),
    };
  };

  const save = async (value: string) => {
    const now = new Date();
    const rules = understand(value, getData(), now);
    if (!rules.title && rules.kind !== "grocery") return;

    // Rules answer instantly and offline. If you've added a Gemini key it gets the final say when it's
    // confident; if it's offline, slow or failing, the rules' answer is used, silently.
    let p = rules;
    if (aiEnabled()) {
      setBusy(true);
      p = (await interpret(value, rules, getData(), now)).parsed;
      setBusy(false);
    }
    const r = perform(p);
    if (r) setResult(r);
  };

  const closeCard = useCallback(() => setResult(null), []);

  return (
    <div>
      {result && <ConfirmCard key={result.id} result={result} data={data} ctx={ctx} onClose={closeCard} />}
      {editing && <EventSheet event={editing} data={getData()} ctx={ctx} onClose={() => setEditing(null)} />}

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
            void save(t);
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
          placeholder="Type or speak anything…"
          aria-label="Capture a task"
          enterKeyHint="done"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-3 text-[17px] placeholder:text-muted/70 focus:outline-none"
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
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${voiceOpen ? "bg-accent-soft text-accent" : "text-muted"}`}
          >
            <MicIcon width={24} height={24} />
          </button>
        )}
        <button
          type="submit"
          disabled={!parsed}
          aria-label="Add"
          aria-busy={busy}
          className={`flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-ink transition disabled:opacity-30 ${busy ? "animate-pulse" : ""}`}
        >
          <ArrowUpIcon width={20} height={20} />
        </button>
      </form>
    </div>
  );
}
