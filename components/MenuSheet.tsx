"use client";
import { useEffect, useRef, useState } from "react";
import { exportBackup, readBackupFile } from "@/lib/backup";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, Sheet, type ViewCtx } from "./ui";

export function MenuSheet({
  data,
  ctx,
  onClose,
  onCheckIn,
}: {
  data: AppData;
  ctx: ViewCtx;
  onClose: () => void;
  onCheckIn: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const last = data.settings.lastBackupAt;

  const onFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const incoming = await readBackupFile(file);
      const ok = confirm(
        `Replace your current ${data.tasks.length} task(s) with the ${incoming.tasks.length} from this backup? Your current data will be overwritten.`,
      );
      if (!ok) return;
      actions.replaceAll({ ...incoming, settings: { ...incoming.settings, lastBackupAt: Date.now() } });
      ctx.notify("Backup restored");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Sheet title="Menu" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold">Daily check-in</h3>
          <p className="mb-2 mt-0.5 text-sm text-muted">Runs once each day when you open the app. Run it again any time.</p>
          <button className={btn.soft} onClick={onCheckIn}>
            Check in now
          </button>
        </section>

        <section>
          <h3 className="text-sm font-semibold">Backup</h3>
          <p className="mb-2 mt-0.5 text-sm text-muted">
            Everything lives on this device only.{" "}
            {last ? `Last backup: ${new Date(last).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : "No backup yet."}{" "}
            I'll remind you every 2 weeks.
          </p>
          <div className="flex gap-2">
            <button
              className={`${btn.primary} flex-1`}
              onClick={() => {
                exportBackup(data);
                actions.settings({ lastBackupAt: Date.now() });
                ctx.notify("Backup downloaded");
              }}
            >
              Export JSON
            </button>
            <button className={`${btn.ghost} flex-1`} onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {error && <p className="mt-2 text-sm text-warn">{error}</p>}
        </section>

        <section>
          <h3 className="text-sm font-semibold">Storage & install</h3>
          <p className="mt-0.5 text-sm text-muted">
            {persisted === true && "Your browser has promised not to clear this data automatically. "}
            {persisted === false && "Your browser may clear data if the device runs low on space, so keep a backup. Installing the app helps. "}
            To install: on iPhone use Share → Add to Home Screen; on Android or desktop Chrome use the install option in the browser menu. It then works offline.
          </p>
        </section>
      </div>
    </Sheet>
  );
}
