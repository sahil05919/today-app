"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { aiEnabled, chooseAmong, interpret } from "@/lib/ai";
import { diffDays, friendlyDate, toISO } from "@/lib/dates";
import { appNoteText } from "@/lib/appNotes";
import { clearSuggestions, parseClear } from "@/lib/clearParse";
import { fmtMinutes } from "@/lib/other";
import { parseLogged, toWorkLog } from "@/lib/workLog";
import { intentOf } from "@/lib/intentPhrases";
import { correctTick, tickFromText, type TickResult } from "@/lib/doneRun";
import { matchDone } from "@/lib/doneText";
import type { ParsedCapture } from "@/lib/parse";
import { teachSuggestion } from "@/lib/teach";
import { actions, getData } from "@/lib/store";
import { buildTimeline, movedNote } from "@/lib/timeline";
import { understand } from "@/lib/understand";
import { voiceSupported } from "@/lib/voice";
import type { AppData, FixedEvent, ISODate } from "@/lib/types";
import { ClearFlow, type ClearFlowState } from "./ClearSheet";
import { ConfirmCard, type CaptureResult } from "./ConfirmCard";
import { isNative } from "@/lib/platform";
import { ArrowUpIcon, ImageIcon, MicIcon } from "./icons";
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

/** One line about what had to move because of what was just added: "Moved Power BI to 18:30 to fit “Fill form”." */
function planNote(before: AppData, date: ISODate | undefined, title: string): string | undefined {
  if (!date) return undefined;
  const now = new Date();
  const ahead = diffDays(date, toISO(now));
  if (ahead < 0 || ahead > 14) return undefined;
  return movedNote(buildTimeline(before, date, now), buildTimeline(getData(), date, now), title) ?? undefined;
}

export function Capture({
  ctx,
  data,
  defaultDate,
  command,
  onLighten,
  onSnap,
}: {
  ctx: ViewCtx;
  data: AppData;
  defaultDate?: ISODate;
  command?: CaptureCommand;
  /** "work done", "I'm free", "lighten my week"…: a command, never a task. */
  onLighten?: () => void;
  /** Snap to Today: read a photo or screenshot. Camera or Gallery. */
  onSnap?: (source: "camera" | "gallery") => void;
}) {
  const [text, setText] = useState("");
  const [snapMenu, setSnapMenu] = useState(false);
  // Only where a picture can be read (the Android app); the desktop preview shows it too so the sheet can be looked at.
  const [snapOk, setSnapOk] = useState(false);
  useEffect(() => setSnapOk(isNative() || process.env.NODE_ENV !== "production"), []);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [editing, setEditing] = useState<FixedEvent | null>(null);
  const [clearFlow, setClearFlow] = useState<ClearFlowState | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Live preview: the same pipeline that runs on Enter (rules, your learned fixes, a sensible time).
  // Commands are recognised first, offline, before any task capture (so they can never be saved as a task).
  // The preview is parsed from a deferred copy of the text, so typing itself never waits for the parser.
  const intent = intentOf(text);
  const typed = useDeferredValue(text);
  const parsed = useMemo(() => (typed.trim() && !intentOf(typed) ? understand(typed, data, new Date()) : null), [typed, data]);

  /** "spent 2 hrs building the app": time already spent, saved as done under Other (or as a session when it names a tracked area). */
  const saveLogged = (value: string) => {
    const l = parseLogged(value, new Date(), getData());
    if (!l) return;
    const area = l.areaId ? ctx.profile.areas.find((a) => a.id === l.areaId) : undefined;
    if (area) {
      const s = actions.addSession(area.id, l.date);
      if (s) ctx.notify(`Logged ${area.name} session ✓`, () => actions.removeSession(s.id));
      return;
    }
    const w = actions.addWorkLog(toWorkLog(l));
    ctx.notify(`Logged ${fmtMinutes(w.minutes)} — ${w.title} ✓`, () => actions.removeWorkLog(w.id));
  };

  /** "clear until 7pm": an action, never a task. A window it understood goes to the preview; otherwise the range picker opens, prefilled. */
  const startClear = (value: string) => {
    const p = parseClear(value, new Date());
    if (!p) return;
    setClearFlow(p.windows.length ? { windows: p.windows, label: p.label } : { picker: true, understood: p.understood });
  };
  // Chips appear as soon as the text starts with "clear" (and while it is still only that).
  const chips = useMemo(() => (intent === "clear" || (/^\s*clear\b/i.test(text) && text.trim().split(/\s+/).length <= 2) ? clearSuggestions(text, new Date()) : null), [text, intent]);

  /** "app: …" is a note to the app, never a task: it goes to Settings → App notes. */
  const saveAppNote = (value: string) => {
    const note = actions.addAppNote(value);
    ctx.notify("Saved to App notes", () => actions.removeAppNote(note.id));
  };

  // The mic only exists where voice can work (and only if you haven't hidden it in Settings).
  const hideMic = ctx.profile.hideMic;
  useEffect(() => {
    const update = () => setVoiceOk(!hideMic && voiceSupported(navigator.onLine));
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [hideMic]);

  useEffect(() => {
    if (!command) return;
    if (command.kind === "voice") {
      if (!hideMic && voiceSupported(navigator.onLine)) {
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
  const perform = (p: ParsedCapture, text: string, aiPick?: number | null): CaptureResult | null => {
    const id = ++seq.current;
    const source = p.source ?? "rules";
    const d = getData();
    const areas = ctx.profile.areas;

    // A tick of anything you have: a session, a check-in, a bill, a chore, a task (see lib/doneRun.ts).
    if (p.kind === "session" || p.kind === "paid" || p.kind === "done") {
      const t = tickFromText(text, p, ctx.profile.name, new Date(), aiPick);
      if (t) return tickResult(id, t, source, text, p.kind === "done" ? p.title : undefined);
      if (p.kind === "done") return null;
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
        note: planNote(d, e.date, e.title),
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
      note: planNote(d, task.due, task.title),
      teach: p.kind === "note" ? undefined : (teachSuggestion(p, d) ?? undefined),
      undo: () => actions.undoAdd(task.id),
    };
  };

  /** The Got-it card for a tick, with "Not this one" to correct it (the fix is remembered). */
  const tickResult = (id: number, t: TickResult, source: "rules" | "ai", value: string, title?: string): CaptureResult => {
    const who = ctx.profile.name;
    const next = (c: TickResult["options"][number]) => {
      const fixed = t.applied ? correctTick(t, c, who, new Date()) : correctTick({ ...t, receipt: undefined }, c, who, new Date());
      setResult(tickResult(++seq.current, fixed, source, value, title));
    };
    return {
      id,
      kind: "done",
      title: t.applied?.label ?? title ?? "Done",
      summary: t.summary,
      source,
      undo: () => {
        if (t.receipt) actions.undoDone(t.receipt);
      },
      done: {
        asking: !t.applied,
        options: t.options.filter((o) => !t.applied || o.item !== t.applied.item || o.date !== t.applied.date),
        pick: next,
        asTask: () => {
          if (t.receipt) actions.undoDone(t.receipt);
          const task = actions.addTask(understand(value.replace(/\b(done|kiya)\b/gi, "").trim() || value, getData(), new Date()), defaultDate);
          setResult({ id: ++seq.current, kind: "task", title: task.title, taskId: task.id, source, undo: () => actions.undoAdd(task.id) });
        },
      },
    };
  };

  const save = async (value: string) => {
    const kind = intentOf(value);
    if (kind === "app") return saveAppNote(value);
    if (kind === "clear") return startClear(value);
    if (kind === "log") return saveLogged(value);
    if (kind === "lighten") {
      onLighten?.();
      return;
    }
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
    // Gemini may only help choose between your own items when the rules can't decide.
    let pick: number | null = null;
    if (aiEnabled() && (p.kind === "done" || p.kind === "session" || p.kind === "paid")) {
      const m = matchDone(value, getData(), now);
      if (m && !m.sure) pick = await chooseAmong(value, m.candidates.map((c) => `${c.label} (${c.dayLabel})`));
    }
    const r = perform(p, value, pick);
    if (r) setResult(r);
    else if (p.kind === "done") {
      // It turned out not to be a tick after all: keep it as an ordinary task.
      const plain = understand(value, getData(), now);
      if (plain.kind !== "done") {
        const rr = perform(plain, value);
        if (rr) setResult(rr);
      }
    }
  };

  const closeCard = useCallback(() => setResult(null), []);

  // Read after mount: the key lives in the browser / phone, so the server render can't know it.
  const [gemini, setGemini] = useState(false);
  useEffect(() => setGemini(aiEnabled()), [result, voiceOpen]);

  return (
    <div>
      {result && <ConfirmCard key={result.id} result={result} data={data} ctx={ctx} onClose={closeCard} />}
      {clearFlow && <ClearFlow flow={clearFlow} data={data} ctx={ctx} onClose={() => setClearFlow(null)} />}
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
      {intent && !voiceOpen && (
        <p className="mb-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium" role="status">
          {intent === "clear" ? "✨ That's a request, not a task: Enter shows what clearing it would move." : intent === "log" ? "✨ That's time you already spent: Enter logs it as done (under Other)." : intent === "app" ? `✨ That's a request, not a task: Enter saves it to App notes (“${appNoteText(text).slice(0, 60)}”).` : "✨ That's a request, not a task: Enter opens Lighten my week."}
        </p>
      )}
      {parsed && !voiceOpen && (
        <div className="mb-2">
          <ParsePreview parsed={parsed} today={ctx.today} defaultDate={defaultDate} areas={ctx.profile.areas} />
        </div>
      )}
      {snapMenu && onSnap && !voiceOpen && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Snap to Today">
          {(["camera", "gallery"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="min-h-10 rounded-full bg-accent-soft px-4 text-sm font-medium text-accent"
              onClick={() => {
                setSnapMenu(false);
                onSnap(s);
              }}
            >
              {s === "camera" ? "Take a photo" : "Choose a picture"}
            </button>
          ))}
        </div>
      )}
      {chips && !voiceOpen && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Clear suggestions">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="min-h-9 rounded-full bg-accent-soft px-3 text-sm font-medium text-accent"
              onClick={() => {
                setText("");
                setClearFlow(c.windows.length ? { windows: c.windows, label: c.label.replace(/^Clear /, "") } : { picker: true, understood: {} });
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (intent === "log") {
            const value = text;
            setText("");
            saveLogged(value);
            return;
          }
          if (intent === "clear") {
            const value = text;
            setText("");
            startClear(value);
            return;
          }
          if (intent === "app") {
            const value = text;
            setText("");
            saveAppNote(value);
            return;
          }
          if (intent) {
            setText("");
            onLighten?.();
            return;
          }
          if (!text.trim()) return;
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
          placeholder={onSnap && snapOk ? "Type, speak or snap…" : "Type or speak anything…"}
          aria-label="Capture a task"
          enterKeyHint="done"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-3 text-[17px] placeholder:text-muted/70 focus:outline-none"
        />
        {onSnap && snapOk && !text && (
          <button
            type="button"
            onClick={() => setSnapMenu((o) => !o)}
            aria-label="Snap a photo or screenshot"
            aria-expanded={snapMenu}
            className={`flex h-12 w-10 shrink-0 items-center justify-center rounded-xl ${snapMenu ? "bg-accent-soft text-accent" : "text-muted"}`}
          >
            <ImageIcon width={24} height={24} />
          </button>
        )}
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
          disabled={!parsed && !intent}
          aria-label="Add"
          aria-busy={busy}
          className={`flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-ink transition disabled:opacity-30 ${busy ? "animate-pulse" : ""}`}
        >
          <ArrowUpIcon width={20} height={20} />
        </button>
      </form>
      {(gemini || busy) && (
        <p className="mt-1.5 px-1 text-xs text-muted" role="status">
          {busy ? "✨ Asking Gemini…" : "✨ Gemini is on. Write it the way you'd say it, like “remind me to call the bank next Tuesday evening”."}
        </p>
      )}
    </div>
  );
}
