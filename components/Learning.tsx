"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiEnabled } from "@/lib/ai";
import { areaNameOf, defaultPick, draftPost, learningsAsText, polishPost, postCard, unusedLearnings } from "@/lib/learning";
import { copyText, shareText } from "@/lib/shareText";
import { actions } from "@/lib/store";
import type { AppData, Learning, SessionLog } from "@/lib/types";
import { btn, field, Sheet, type ViewCtx } from "./ui";

const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Right after a session of a chosen area: one line, keyboard open. A prompt inside the app, never a notification. */
export function LearningPrompt({ log, data, ctx, onClose }: { log: SessionLog; data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [text, setText] = useState("");
  const area = ctx.profile.areas.find((a) => a.id === log.areaId);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  void data;
  return (
    <Sheet title="What did you learn?" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          actions.addLearning(log.areaId, text, log.date);
          ctx.notify("Saved to your learning log 📓");
          onClose();
        }}
      >
        <p className="-mt-1 text-sm text-muted">
          {area?.emoji} {area?.name ?? log.areaId}: one line is plenty.
        </p>
        <input ref={input} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. CALCULATE changes the filter context" aria-label="What did you learn?" enterKeyHint="done" className={field} maxLength={300} />
        <div className="flex gap-2">
          <button type="submit" className={`${btn.primary} min-h-12 flex-1`} disabled={!text.trim()}>
            Save
          </button>
          <button type="button" className={`${btn.ghost} min-h-12 flex-1`} onClick={onClose}>
            Skip
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Menu → Learning log: by date with the area; edit, delete, Copy all, Share, and turn a few into a post. */
export function LearningLogSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const list = useMemo(() => [...(data.learnings ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at), [data.learnings]);
  const name = areaNameOf(data);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [post, setPost] = useState(false);
  const unused = unusedLearnings(data).length;
  const emoji = (id: string) => ctx.profile.areas.find((a) => a.id === id)?.emoji ?? "•";
  return (
    <Sheet title="Learning log" onClose={onClose}>
      {list.length === 0 ? (
        <p className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">Nothing yet. After a Power BI session the app asks, “What did you learn?”. You choose which areas ask in Settings → Learning log.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((l) => (
            <li key={l.id} className="rounded-xl bg-bg px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
                <span>
                  {pretty(l.date)} · {emoji(l.areaId)} {name(l.areaId)}
                </span>
                {l.usedAt ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">used in a post</span> : null}
              </div>
              {editing === l.id ? (
                <form
                  className="mt-1 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    actions.updateLearning(l.id, draft);
                    setEditing(null);
                  }}
                >
                  <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className={field} aria-label="Edit learning" />
                  <button className={`${btn.primary} min-h-11`} type="submit">
                    Save
                  </button>
                </form>
              ) : (
                <div className="mt-0.5 flex items-start gap-1">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setEditing(l.id);
                      setDraft(l.text);
                    }}
                    aria-label={`Edit: ${l.text}`}
                  >
                    {l.text}
                  </button>
                  <button aria-label={`Delete: ${l.text}`} className="-mr-1 min-h-9 px-2 text-muted" onClick={() => actions.removeLearning(l.id)}>
                    ✕
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className={`${btn.soft} min-h-11 flex-1`}
          disabled={!list.length}
          onClick={async () => ctx.notify((await copyText(learningsAsText(list, name))) ? "Copied" : "Couldn't copy on this device")}
        >
          Copy all
        </button>
        <button className={`${btn.ghost} min-h-11 flex-1`} disabled={!list.length} onClick={() => void shareText(learningsAsText(list, name), "What I have been learning")}>
          Share
        </button>
      </div>
      {unused > 0 && (
        <button className={`${btn.primary} mt-2 min-h-12 w-full`} onClick={() => setPost(true)}>
          📝 Turn some into a LinkedIn post
        </button>
      )}
      {post && <PostDraftSheet data={data} ctx={ctx} onClose={() => setPost(false)} />}
    </Sheet>
  );
}

/** The Sunday card: "You have 8 learnings — turn 3 into a LinkedIn post?" (only with 5 or more unused). */
export function LearningCard({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const [open, setOpen] = useState(false);
  const card = postCard(data);
  if (!card) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-2xl bg-accent-soft p-3.5 text-left">
        <span className="text-2xl" aria-hidden="true">
          📝
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-medium">{card.text}</span>
        <span className="shrink-0 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink">Draft</span>
      </button>
      {open && <PostDraftSheet data={data} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Pick the learnings, see an offline draft, optionally polish it with Gemini (only the chosen lines are sent), then copy or share. */
export function PostDraftSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const unused = useMemo(() => unusedLearnings(data).sort((a, b) => b.at - a.at), [data]);
  const name = areaNameOf(data);
  const [chosen, setChosen] = useState<string[]>(() => defaultPick(data).map((l) => l.id));
  const picked = useMemo(() => unused.filter((l) => chosen.includes(l.id)), [unused, chosen]);
  const template = useMemo(() => draftPost(picked, name), [picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const text = edited ?? template;
  const pick = (l: Learning) => {
    setEdited(null);
    setChosen((c) => (c.includes(l.id) ? c.filter((x) => x !== l.id) : [...c, l.id]));
  };
  const markUsed = () => {
    actions.markLearningsUsed(picked.map((l) => l.id));
    ctx.notify("Marked as used 📝");
    onClose();
  };
  return (
    <Sheet title="LinkedIn post" onClose={onClose}>
      <div className="space-y-3">
        <section aria-label="Choose learnings">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Which learnings? ({picked.length} chosen)</h3>
          <ul className="max-h-44 space-y-1 overflow-y-auto">
            {unused.map((l) => (
              <li key={l.id}>
                <label className="flex min-h-10 items-start gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
                  <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => pick(l)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
                  <span>
                    {l.text} <span className="text-xs text-muted">· {name(l.areaId)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={10} aria-label="Post draft" className={`${field} font-[inherit] leading-relaxed`} />
        {note && (
          <p className="text-xs text-muted" role="status">
            {note}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`${btn.soft} min-h-11`}
            disabled={busy || !picked.length}
            onClick={async () => {
              if (!aiEnabled()) return setNote("Add your Gemini key in Settings → Smart parsing to polish. The draft above works without it.");
              setBusy(true);
              setNote("✨ Asking Gemini… only your chosen lines are sent, and nothing is kept.");
              const r = await polishPost(picked, name);
              setBusy(false);
              if (r.ok) {
                setEdited(r.text);
                setNote("Polished. You can still edit it. Pick the learnings again to go back to the plain draft.");
              } else setNote(`Couldn't polish it (${r.reason}). The plain draft is still here.`);
            }}
          >
            {busy ? "Polishing…" : "✨ Polish with Gemini"}
          </button>
          <button className={`${btn.soft} min-h-11`} disabled={!text} onClick={async () => ctx.notify((await copyText(text)) ? "Copied" : "Couldn't copy on this device")}>
            Copy
          </button>
        </div>
        <button
          className={`${btn.primary} min-h-12 w-full`}
          disabled={!text}
          onClick={async () => {
            const r = await shareText(text, "LinkedIn post");
            if (r === "shared") markUsed();
            else if (r === "copied") setNote("Copied (no share sheet here). Tap “I posted it” when it is up.");
          }}
        >
          Share to LinkedIn…
        </button>
        <button className={`${btn.ghost} min-h-11 w-full`} disabled={!picked.length} onClick={markUsed}>
          ✓ I posted it (mark these as used)
        </button>
      </div>
    </Sheet>
  );
}
