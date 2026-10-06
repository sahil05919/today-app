"use client";
import { useEffect, useRef, useState } from "react";
import { exportBackup, readBackupFile } from "@/lib/backup";
import { actions } from "@/lib/store";
import { getTheme, setTheme, type ThemePref } from "@/lib/theme";
import type { AppData } from "@/lib/types";
import { btn, Sheet, type Panel, type ViewCtx } from "./ui";

export function MenuSheet({
  data,
  ctx,
  onClose,
  onCheckIn,
  onPanel,
}: {
  data: AppData;
  ctx: ViewCtx;
  onClose: () => void;
  onCheckIn: () => void;
  onPanel: (p: Panel) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [theme, setThemeState] = useState<ThemePref>("system");

  useEffect(() => {
    setThemeState(getTheme());
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
          <h3 className="mb-2 text-sm font-semibold">Appearance</h3>
          <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="group" aria-label="Theme">
            {(["system", "light", "dark"] as ThemePref[]).map((t) => (
              <button
                key={t}
                aria-pressed={theme === t}
                onClick={() => {
                  setThemeState(t);
                  setTheme(t);
                }}
                className={`min-h-11 flex-1 rounded-lg capitalize ${theme === t ? "bg-surface shadow-sm" : "text-muted"}`}
              >
                {t === "system" ? "Follow phone" : t}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Plan & reflect</h3>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["me", "⚙️ Settings"],
                ["shopping", "🛒 Shopping list"],
                ["bills", "💳 Bills & chores"],
                ["goals", "🎯 Must-haves"],
                ["review", "🗓️ Weekly review"],
                ["patterns", "📈 My patterns"],
                ["bored", "🎲 Getting bored?"],
                ["plan", "🗺️ Plan my tasks"],
                ["morning", "☀️ Pick my 3"],
                ["evening", "🌙 Wrap up"],
                ["events", "🎟️ London events"],
              ] as [Panel, string][]
            ).map(([p, label]) => (
              <button key={p} className={`${btn.ghost} min-h-12 text-left`} onClick={() => onPanel(p)}>
                {label}
              </button>
            ))}
          </div>
        </section>

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

        <p className="pb-1 text-center text-xs text-muted">Sahil's Today · created by Sahil</p>
      </div>
    </Sheet>
  );
}
