"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyDate } from "@/lib/dates";
import { snapPick } from "@/lib/nativeBridge";
import { isNative } from "@/lib/platform";
import { addDraft, type Draft } from "@/lib/snap/create";
import { nativeDeps } from "@/lib/snap/deps";
import { blocker, emptyState, startSnap, type ReviewItem, type SnapDeps, type SnapRun, type SnapState } from "@/lib/snap/run";
import { LOW_CONF, TYPE_LABEL, type FieldName, type SnapAs } from "@/lib/snap/types";
import type { AppData } from "@/lib/types";
import { btn, Chip, field, Sheet, type ViewCtx } from "./ui";

/** What opens Snap to Today: pictures that were shared to the app, or "take one" / "choose one". */
export interface SnapRequest {
  id: number;
  source?: "camera" | "gallery";
  uris?: string[];
  /** Tests and the dev preview hand in their own reader. */
  deps?: SnapDeps;
}

const AS_LABEL: Record<SnapAs, string> = { event: "Event", task: "Task", bill: "Bill", note: "Note" };
const AS_ORDER: SnapAs[] = ["event", "task", "bill", "note"];

const low = (r: ReviewItem, f: FieldName) => r.conf[f] !== undefined && (r.conf[f] as number) < LOW_CONF;
const flagged = (r: ReviewItem, f: FieldName) => low(r, f) || (!!r.checkDate && (f === "date" || f === "start" || f === "end"));
const ring = (on: boolean) => (on ? " !border-warn bg-warn-soft" : "");

const draftOf = (r: ReviewItem): Draft => ({
  as: r.as,
  type: r.type,
  title: r.title.trim(),
  date: r.date,
  start: r.start,
  end: r.end,
  allDay: r.allDay,
  location: r.location,
  amount: r.amount,
  dueDate: r.dueDate,
  reference: r.reference,
  source: r.source,
  notes: r.notes,
  matchesBill: r.matchesBill,
});

/** One line that says what was found, with the shaky parts marked. */
function Summary({ r, today }: { r: ReviewItem; today: string }) {
  const Mark = ({ f, children }: { f: FieldName; children: React.ReactNode }) => (flagged(r, f) ? <mark className="rounded bg-warn-soft px-1 text-ink">{children}</mark> : <>{children}</>);
  const parts: React.ReactNode[] = [];
  const day = r.as === "bill" ? (r.dueDate ?? r.date) : r.date;
  if (day) parts.push(<Mark key="d" f={r.as === "bill" ? "dueDate" : "date"}>{r.as === "bill" ? "Due " : ""}{friendlyDate(day, today)}</Mark>);
  if (r.start) parts.push(<Mark key="t" f="start">{r.start}{r.end ? `–${r.end}` : ""}</Mark>);
  else if (r.as === "event" && r.allDay) parts.push(<span key="t">All day</span>);
  if (r.amount !== undefined) parts.push(<Mark key="a" f="amount">£{r.amount.toFixed(2)}</Mark>);
  if (r.location) parts.push(<Mark key="l" f="location">{r.location}</Mark>);
  if (!parts.length) return <p className="text-sm text-muted">No date found</p>;
  return (
    <p className="text-sm text-muted">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </p>
  );
}

function ItemCard({ r, today, startOpen, patch, onAdd, onDiscard, onUndo }: { r: ReviewItem; today: string; startOpen: boolean; patch: (p: Partial<ReviewItem>) => void; onAdd: () => void; onDiscard: () => void; onUndo: () => void }) {
  const [open, setOpen] = useState(startOpen);
  const why = blocker(r);
  const needsTime = r.as === "event" && !!r.date && !r.start && !r.allDay;
  const isBill = r.as === "bill";

  if (r.status === "added") {
    return (
      <li className="flex items-center justify-between gap-2 rounded-2xl bg-accent-soft px-4 py-2 text-sm font-medium" aria-live="polite">
        <span className="min-w-0 truncate">✓ Added: {r.title}</span>
        <button type="button" className="min-h-9 shrink-0 rounded-lg px-2 font-semibold text-accent" onClick={onUndo}>
          Undo
        </button>
      </li>
    );
  }
  if (r.status === "discarded") return null;

  return (
    <li className="rounded-2xl border border-line bg-bg p-3.5" data-snap-item>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Chip tone="accent">{TYPE_LABEL[r.type]}</Chip>
            {r.source && <Chip>{r.source}</Chip>}
            {r.via === "both" || r.via === "gemini" ? <Chip tone="warn">Gemini helped</Chip> : null}
          </div>
          {!open && <h3 className={`text-[15px] font-semibold${flagged(r, "title") ? " rounded bg-warn-soft px-1" : ""}`}>{r.title || "Untitled"}</h3>}
          {!open && <Summary r={r} today={today} />}
        </div>
        <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-accent" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Done editing" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Title</span>
            <input value={r.title} onChange={(e) => patch({ title: e.target.value })} className={field + ring(flagged(r, "title"))} aria-label="Title" />
          </label>
          <div role="group" aria-label="Save as" className="flex flex-wrap gap-1.5">
            {AS_ORDER.map((a) => (
              <button key={a} type="button" aria-pressed={r.as === a} onClick={() => patch({ as: a })} className={`min-h-9 rounded-full px-3 text-sm font-medium ${r.as === a ? "bg-accent text-accent-ink" : "border border-line bg-surface"}`}>
                {AS_LABEL[a]}
              </button>
            ))}
          </div>
          {r.as !== "note" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-medium text-muted">{isBill ? "Due date" : "Date"}</span>
                <input
                  type="date"
                  value={(isBill ? (r.dueDate ?? r.date) : r.date) ?? ""}
                  onChange={(e) => patch(isBill ? { dueDate: e.target.value || undefined, date: e.target.value || undefined, checkDate: false } : { date: e.target.value || undefined, checkDate: false })}
                  className={field + ring(flagged(r, isBill ? "dueDate" : "date"))}
                  aria-label="Date"
                />
              </label>
              {!isBill && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">From</span>
                    <input type="time" value={r.start ?? ""} onChange={(e) => patch({ start: e.target.value || undefined, end: e.target.value ? r.end : undefined, allDay: false, checkDate: false })} className={field + ring(flagged(r, "start"))} aria-label="Start time" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">To</span>
                    <input type="time" value={r.end ?? ""} onChange={(e) => patch({ end: e.target.value || undefined })} disabled={!r.start} className={field + ring(flagged(r, "end"))} aria-label="End time" />
                  </label>
                </>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Where</span>
                <input value={r.location ?? ""} onChange={(e) => patch({ location: e.target.value || undefined })} className={field + ring(flagged(r, "location"))} aria-label="Location" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Amount (£)</span>
                <input
                  inputMode="decimal"
                  value={r.amount === undefined ? "" : String(r.amount)}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                    patch({ amount: isFinite(n) ? n : undefined });
                  }}
                  className={field + ring(flagged(r, "amount"))}
                  aria-label="Amount"
                />
              </label>
            </div>
          )}
          {(r.reference || r.notes) && (
            <p className="text-xs text-muted">
              {r.reference ? `Ref ${r.reference}` : ""}
              {r.reference && r.notes ? " · " : ""}
              {r.notes ?? ""}
            </p>
          )}
        </div>
      )}

      {r.checkDate && (
        <div className="mt-2.5 rounded-xl bg-warn-soft px-3 py-2 text-sm" role="alert">
          <span className="font-medium">Check the date{r.start || r.alt?.start ? " and time" : ""}.</span>{" "}
          {r.alt?.date || r.alt?.start || r.alt?.dueDate ? (
            <>
              Gemini read it as {[r.alt.date ?? r.alt.dueDate ? friendlyDate((r.alt.date ?? r.alt.dueDate)!, today) : "", r.alt.start ?? ""].filter(Boolean).join(" ")}.{" "}
              <button
                type="button"
                className="font-semibold text-accent underline underline-offset-2"
                onClick={() => patch({ date: r.alt?.date ?? r.date, start: r.alt?.start ?? r.start, end: r.alt?.end ?? r.end, dueDate: r.alt?.dueDate ?? r.dueDate, checkDate: false, alt: undefined })}
              >
                Use that
              </button>
            </>
          ) : (
            "That day has already passed, or I wasn't sure of it."
          )}
        </div>
      )}

      {needsTime && (
        <div className="mt-2.5 rounded-xl bg-accent-soft px-3 py-2.5" role="group" aria-label="Time needed">
          <p className="mb-2 text-sm font-medium">What time?</p>
          <div className="flex items-center gap-2">
            <input type="time" aria-label="Pick a time" onChange={(e) => e.target.value && patch({ start: e.target.value, allDay: false })} className={field + " w-36"} />
            <button type="button" className={`${btn.ghost} min-h-11`} onClick={() => patch({ allDay: true })}>
              All day
            </button>
          </div>
        </div>
      )}

      {r.dup && (
        <div className="mt-2.5 rounded-xl bg-warn-soft px-3 py-2.5" role="alert">
          <p className="text-sm font-medium">Looks like you already have “{r.dup.title}” on {friendlyDate(r.dup.date, today)}.</p>
          {!r.dupChoice && (
            <div className="mt-2 flex gap-2">
              <button type="button" className={`${btn.primary} min-h-10`} onClick={onDiscard}>
                Skip it
              </button>
              <button type="button" className={`${btn.ghost} min-h-10`} onClick={() => patch({ dupChoice: "add" })}>
                Add anyway
              </button>
            </div>
          )}
        </div>
      )}

      {r.matchesBill && <p className="mt-2 text-xs text-muted">This looks like your “{r.matchesBill}” bill, whose reminders are already set. Adding it makes a one-off reminder for this amount.</p>}

      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={`${btn.primary} min-h-11 flex-1`} onClick={onAdd} disabled={!!why} title={why ?? undefined}>
          {r.as === "note" ? "Save note" : "Add"}
        </button>
        <button type="button" className={`${btn.ghost} min-h-11`} onClick={onDiscard}>
          Discard
        </button>
      </div>
      {why && !r.dup && !needsTime && <p className="mt-1.5 text-xs text-muted">{why}</p>}
    </li>
  );
}

/**
 * Snap to Today. Opens the camera or the picker (or takes pictures shared to the app), shows "Reading…" at once with a Cancel button,
 * then one review list for every picture. NOTHING is saved until you tap Add. Only the details are kept: never the picture.
 */
export default function SnapSheet({ request, data, ctx, onClose }: { request: SnapRequest; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [uris, setUris] = useState<string[] | null>(request.uris ?? null);
  const [state, setState] = useState<SnapState>(() => emptyState(request.uris?.length ?? 1));
  const [noteText, setNoteText] = useState<string | null>(null);
  const run = useRef<SnapRun | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const deps = useMemo(() => request.deps ?? nativeDeps(), [request.deps]);
  const today = ctx.today;

  // 1. Where the pictures come from.
  useEffect(() => {
    if (uris) return;
    let alive = true;
    void (async () => {
      const got = request.source && isNative() ? await snapPick(request.source) : null;
      if (!alive) return;
      if (!got) {
        ctx.notify(request.source === "camera" ? "Couldn't open the camera." : "Couldn't open your pictures.");
        closeRef.current();
      } else if (got.cancelled || !got.uris.length) closeRef.current();
      else setUris(got.uris);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  // 2. Reading them: one after the other, into one list. Leaving the sheet cancels and frees every picture.
  useEffect(() => {
    if (!uris) return;
    setState(emptyState(uris.length));
    const r = startSnap({ uris, deps, getData: () => dataRef.current, onState: setState });
    run.current = r;
    return () => r.cancel();
  }, [uris, deps]);

  const patch = useCallback((id: string, p: Partial<ReviewItem>) => setState((s) => ({ ...s, items: s.items.map((x) => (x.id === id ? { ...x, ...p, edited: true } : x)) })), []);
  const mark = useCallback((ids: string[], status: ReviewItem["status"]) => setState((s) => ({ ...s, items: s.items.map((x) => (ids.includes(x.id) ? { ...x, status } : x)) })), []);

  // How to take each added item back (the card's own Undo; the toast has one too while it is showing).
  const undos = useRef(new Map<string, () => void>());
  const undoOne = (id: string) => {
    undos.current.get(id)?.();
    undos.current.delete(id);
    mark([id], "pending");
  };

  const addOne = (r: ReviewItem) => {
    try {
      const a = addDraft(draftOf(r));
      undos.current.set(r.id, a.undo);
      mark([r.id], "added");
      ctx.notify(a.summary, () => undoOne(r.id));
    } catch {
      ctx.notify("Couldn't add that one. Try again.");
    }
  };

  const pending = state.items.filter((x) => x.status === "pending");
  const ready = pending.filter((x) => !blocker(x));
  const addAll = () => {
    const ids: string[] = [];
    for (const r of ready) {
      try {
        undos.current.set(r.id, addDraft(draftOf(r)).undo);
        ids.push(r.id);
      } catch {
        /* that one stays in the list */
      }
    }
    mark(ids, "added");
    if (ids.length) ctx.notify(ids.length === 1 ? "Added 1 item" : `Added ${ids.length} items`, () => ids.forEach(undoOne));
  };

  // Everything answered: close by itself.
  const answered = state.phase === "ready" && state.items.length > 0 && pending.length === 0;
  useEffect(() => {
    if (!answered) return;
    const id = setTimeout(() => closeRef.current(), 700);
    return () => clearTimeout(id);
  }, [answered]);

  // While the camera or the picker is open there is nothing to show yet.
  if (!uris) return null;

  const reading = state.phase === "reading";
  const nothing = state.phase === "ready" && state.items.length === 0;
  const text = noteText ?? state.text;

  const saveNote = () => {
    const body = text.trim();
    if (!body) return;
    const first = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "Note";
    const a = addDraft({ as: "note", type: "note", title: first.slice(0, 60), notes: body.length > first.length ? body.slice(0, 1500) : undefined });
    ctx.notify(a.summary, a.undo);
    onClose();
  };

  return (
    <Sheet title="Snap to Today" onClose={onClose}>
      {reading && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-accent-soft px-4 py-3" role="status">
          <p className="animate-pulse text-sm font-medium">{uris && uris.length > 1 ? `Reading… ${Math.min(state.done + 1, uris.length)} of ${uris.length}` : "Reading…"}</p>
          <button type="button" className={`${btn.ghost} min-h-10`} onClick={() => (run.current?.cancel(), onClose())}>
            Cancel
          </button>
        </div>
      )}
      {!reading && !nothing && <p className="-mt-1 mb-3 text-sm text-muted">Nothing is saved until you tap Add. Only the details are kept, never the picture.</p>}

      {state.online === "asking" && <p className="mb-2 text-xs text-muted" role="status">✨ Gemini is double-checking this…</p>}
      {state.improved && state.online !== "asking" && <p className="mb-2 text-xs text-muted">✨ Improved with Gemini</p>}
      {state.notices.map((n) => (
        <p key={n} className="mb-2 rounded-xl bg-bg px-3 py-2 text-sm text-muted" role="status">
          {n}
        </p>
      ))}

      {state.items.length > 0 && (
        <ul className="space-y-3">
          {state.items.map((r) => (
            <ItemCard key={r.id} r={r} today={today} startOpen={state.items.length === 1} patch={(p) => patch(r.id, p)} onAdd={() => addOne(r)} onDiscard={() => mark([r.id], "discarded")} onUndo={() => undoOne(r.id)} />
          ))}
        </ul>
      )}

      {nothing && (
        <div className="space-y-3">
          <p className="text-sm">{state.text.trim() ? "I couldn't turn this into a task, event or bill. Here is what I read, so you can still keep it:" : "I couldn't find anything to add from that picture."}</p>
          {(state.text.trim() || noteText !== null) && (
            <>
              <textarea value={text} onChange={(e) => setNoteText(e.target.value)} rows={8} className={`${field} resize-y`} aria-label="Text from the picture" />
              <button type="button" className={`${btn.primary} min-h-12 w-full`} onClick={saveNote} disabled={!text.trim()}>
                Save as a note
              </button>
            </>
          )}
          <button type="button" className={`${btn.ghost} min-h-11 w-full`} onClick={onClose}>
            Close
          </button>
        </div>
      )}

      {!nothing && state.items.length > 0 && (
        <div className="mt-4 space-y-2">
          {ready.length > 1 && (
            <button type="button" className={`${btn.primary} min-h-12 w-full`} onClick={addAll}>
              Add all ({ready.length})
            </button>
          )}
          {pending.length > ready.length && ready.length > 0 && <p className="text-center text-xs text-muted">{pending.length - ready.length} need a look first.</p>}
          {!reading && (
            <button type="button" className={`${btn.ghost} min-h-11 w-full`} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
