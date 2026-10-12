"use client";
import { useState } from "react";
import { cardIssues } from "@/lib/selfcheck";
import { actions } from "@/lib/store";
import type { AppData, CheckIssue, CheckResult } from "@/lib/types";
import { btn, Sheet } from "./ui";

export type CheckAction = NonNullable<CheckIssue["action"]>;

/** "2 things need a look": one small card, only when the morning self-check found something it could not fix by itself. */
export function CheckCard({ data, today, onAction }: { data: AppData; today: string; onAction: (a: CheckAction) => void }) {
  const [open, setOpen] = useState(false);
  const issues = cardIssues(data.settings.lastCheck, today);
  if (!issues.length || data.settings.checkDismissed === today) return null;
  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl bg-warn-soft p-3.5">
        <span className="text-2xl" aria-hidden="true">
          🔎
        </span>
        <button onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
          <span className="block text-[15px] font-semibold text-ink">
            {issues.length} {issues.length === 1 ? "thing needs" : "things need"} a look
          </span>
          <span className="block truncate text-sm text-muted">{issues[0].text}</span>
        </button>
        <button onClick={() => actions.settings({ checkDismissed: today })} className="min-h-10 px-2 text-sm text-muted">
          Not now
        </button>
      </div>
      {open && <CheckSheet result={data.settings.lastCheck!} onClose={() => setOpen(false)} onAction={(a) => (setOpen(false), onAction(a))} />}
    </>
  );
}

const ACTION_LABEL: Record<CheckAction, string> = { targets: "Choose", lighten: "Pull forward", backup: "Back up now" };

/** What the check found: the things to look at (with a button each), and what it fixed quietly. */
export function CheckSheet({ result, onClose, onAction }: { result: CheckResult; onClose: () => void; onAction: (a: CheckAction) => void }) {
  return (
    <Sheet title="Morning check" onClose={onClose}>
      {result.issues.length === 0 && <p className="py-2 text-[15px]">Everything looks good ✅</p>}
      <ul className="space-y-2">
        {result.issues.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
            <span className="min-w-0 flex-1 text-[15px]">{i.text}</span>
            {i.action && (
              <button className={`${btn.soft} min-h-10 shrink-0`} onClick={() => onAction(i.action!)}>
                {ACTION_LABEL[i.action]}
              </button>
            )}
          </li>
        ))}
      </ul>
      {result.fixed.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Fixed quietly</h3>
          <ul className="space-y-1 text-sm text-muted">
            {result.fixed.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
