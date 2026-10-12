"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { backupNow, backupState, inspectBackup, restoreFromText, shareLatest, type BackupState } from "@/lib/backupFiles";
import { exportBackup } from "@/lib/backup";
import { isNative } from "@/lib/platform";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, Sheet, type ViewCtx } from "./ui";

const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Settings → Backups. Every Sunday at 21:30 the whole data is written to Documents/TodayBackups (it survives uninstalling the app),
 * and the last 8 are kept. Back up now, restore from a file (with a confirm and a safety copy first), or share the latest one
 * (Google Drive, email…). On the web the same buttons download the JSON instead.
 */
export function BackupSettings({ data, ctx }: { data: AppData; ctx: ViewCtx }) {
  const native = isNative();
  const [state, setState] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ text: string; tasks: number; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (native) setState(await backupState());
  }, [native]);
  useEffect(() => {
    void refresh();
  }, [refresh, data.settings.lastBackupAt]);

  const now = async () => {
    setBusy(true);
    setError("");
    if (native) {
      const r = await backupNow();
      if (r.ok) ctx.notify(`Backed up: Documents/TodayBackups/${r.name}`);
      else setError(r.error);
      await refresh();
    } else {
      exportBackup(data);
      actions.settings({ lastBackupAt: Date.now() });
      ctx.notify("Backup downloaded");
    }
    setBusy(false);
  };

  const pick = async (file?: File) => {
    if (!file) return;
    setError("");
    const text = await file.text();
    const r = inspectBackup(text);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return setError(r.error);
    setPending({ text, tasks: r.data.tasks.length + (r.data.series?.length ?? 0), name: file.name });
  };

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    const r = await restoreFromText(pending.text);
    setBusy(false);
    setPending(null);
    if (!r.ok) return setError(r.error);
    ctx.notify(r.safety ? `Restored. Your previous data is in ${r.safety}` : "Restored");
    await refresh();
  };

  const last = state?.lastAt || data.settings.lastBackupAt;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {native ? "Every Sunday at 21:30 the whole app is saved to Documents/TodayBackups, a folder that stays when the app is uninstalled. The last 8 are kept." : "Backups to the phone's Documents folder work in the Android app. Here the button downloads a JSON file."}
      </p>
      <div className="rounded-2xl bg-bg p-3 text-sm">
        <p>
          <span className="text-muted">Last backup: </span>
          <span className="font-medium">{last ? when(last) : "none yet"}</span>
        </p>
        {native && state && (
          <p className="mt-0.5 text-xs text-muted">
            {state.count} {state.count === 1 ? "file" : "files"} kept · next one {when(state.nextAt)}
          </p>
        )}
      </div>
      <button type="button" className={`${btn.primary} min-h-11 w-full`} disabled={busy} onClick={now}>
        {busy ? "Working…" : "Backup now"}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`${btn.ghost} min-h-11`} disabled={busy} onClick={() => fileRef.current?.click()}>
          Restore from file
        </button>
        <button
          type="button"
          className={`${btn.ghost} min-h-11`}
          disabled={busy || !native || !state?.files.length}
          onClick={async () => {
            if (!(await shareLatest())) setError("Couldn't open the share sheet.");
          }}
        >
          Share latest backup
        </button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {error && (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      )}
      {native && state && state.files.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-10 cursor-pointer text-muted">The backups on this phone</summary>
          <ul className="mt-1 space-y-1">
            {state.files.map((f) => (
              <li key={f.uri} className="flex justify-between rounded-lg bg-bg px-3 py-1.5 text-xs">
                <span>{f.name}</span>
                <span className="text-muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {pending && (
        <Sheet title="Restore this backup?" onClose={() => setPending(null)}>
          <p className="text-[15px] leading-relaxed">
            This replaces what is on the phone now with <b>{pending.name}</b> ({pending.tasks} tasks and repeats).
          </p>
          <p className="mt-2 text-sm text-muted">{native ? "A safety copy of your current data is saved first, so you can come back." : "Your current data will be overwritten. Export a backup first if you might want it."}</p>
          <div className="mt-4 flex gap-2">
            <button className={`${btn.primary} min-h-12 flex-1`} disabled={busy} onClick={restore}>
              Restore
            </button>
            <button className={`${btn.ghost} min-h-12 flex-1`} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** The Backups screen on its own (opened from the morning check). */
export function BackupsSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  return (
    <Sheet title="Backups" onClose={onClose}>
      <BackupSettings data={data} ctx={ctx} />
    </Sheet>
  );
}
