"use client";
import { useState } from "react";
import { clearErrors, formatErrors, getErrors, type ErrorEntry } from "@/lib/debugLog";
import { checkSummary } from "@/lib/selfcheck";
import { runCheck } from "@/lib/selfcheckRun";
import type { AppData } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

/** Settings → Health: the last self-check, and a button to run it now. */
export function HealthSettings({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const [busy, setBusy] = useState(false);
  const last = data.settings.lastCheck;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Every morning Today checks itself: every weekly target planned, no duplicates, every reminder scheduled, nothing stuck, a recent backup. Safe things are fixed quietly.
      </p>
      <div className="rounded-2xl bg-bg p-3">
        <p className="text-[15px] font-semibold">{checkSummary(last)}</p>
        {last && <p className="text-xs text-muted">Last run {new Date(last.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
        {last?.issues.map((i) => (
          <p key={i.id} className="mt-1.5 text-sm">
            ⚠️ {i.text}
          </p>
        ))}
        {last?.fixed.map((f) => (
          <p key={f} className="mt-1.5 text-sm text-muted">
            ✓ {f}
          </p>
        ))}
      </div>
      <button
        className={`${btn.primary} min-h-11 w-full`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await runCheck();
          setBusy(false);
          ctx.notify(r.issues.length ? `${r.issues.length} to look at` : "All good ✅");
        }}
      >
        {busy ? "Checking…" : "Run now"}
      </button>
      <RecentErrors ctx={ctx} />
    </div>
  );
}

/** The last 50 errors the app caught, with a Copy button to paste them to Claude (or any developer). */
function RecentErrors({ ctx }: { ctx: ViewCtx }) {
  const [list, setList] = useState<ErrorEntry[]>(() => getErrors());
  const when = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="text-[15px] font-semibold">Recent errors</p>
      <p className="mb-2 text-xs text-muted">If the app ever feels stuck, copy this and paste it to Claude. It lists the last 50 things that went wrong, and nothing else.</p>
      {list.length === 0 ? (
        <p className="text-sm text-muted">Nothing has gone wrong. ✅</p>
      ) : (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
          {[...list].reverse().map((e, i) => (
            <li key={i} className="rounded-lg bg-bg px-2 py-1.5">
              <span className="text-muted">{when(e.at)} · {e.where}{e.n && e.n > 1 ? ` · ×${e.n}` : ""}</span>
              <span className="block break-words">{e.msg}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <button
          className={`${btn.soft} min-h-11 flex-1`}
          disabled={!list.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(formatErrors(list));
              ctx.notify("Copied. Paste it into your chat with Claude");
            } catch {
              ctx.notify("Couldn't copy. Select the text instead");
            }
          }}
        >
          Copy
        </button>
        <button className={`${btn.ghost} min-h-11`} onClick={() => setList(getErrors())}>
          Refresh
        </button>
        <button
          className={`${btn.ghost} min-h-11`}
          disabled={!list.length}
          onClick={() => {
            clearErrors();
            setList([]);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
