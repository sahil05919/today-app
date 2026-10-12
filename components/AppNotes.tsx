"use client";
import { notesAsBullets } from "@/lib/appNotes";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

/** Settings → App notes: what you typed as "app: …". Delete one, copy them all as a bullet list for Claude, or share. */
export function AppNotes({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const notes = data.notes ?? [];
  const when = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notesAsBullets(notes));
      ctx.notify("Copied. Paste it into your chat with Claude");
    } catch {
      ctx.notify("Couldn't copy on this device");
    }
  };
  const share = async () => {
    const text = notesAsBullets(notes);
    try {
      if (navigator.share) await navigator.share({ title: "Notes about my Today app", text });
      else await copy();
    } catch {
      /* the share sheet was closed */
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Type <b>app:</b> before anything in the capture bar (for example “app: walk reminder feels too early”) and it lands here instead of becoming a task.
      </p>
      {notes.length === 0 ? (
        <p className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {[...notes].reverse().map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-xl bg-bg px-3 py-2">
              <span className="w-14 shrink-0 pt-0.5 text-xs text-muted">{when(n.date)}</span>
              <span className="min-w-0 flex-1 break-words text-sm">{n.text}</span>
              <button aria-label={`Delete note: ${n.text}`} className="-mr-1 min-h-9 px-2 text-muted" onClick={() => actions.removeAppNote(n.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button className={`${btn.soft} min-h-11 flex-1`} disabled={!notes.length} onClick={copy}>
          Copy all
        </button>
        <button className={`${btn.ghost} min-h-11 flex-1`} disabled={!notes.length} onClick={share}>
          Share
        </button>
      </div>
    </div>
  );
}
