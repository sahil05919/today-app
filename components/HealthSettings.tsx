"use client";
import { useState } from "react";
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
    </div>
  );
}
