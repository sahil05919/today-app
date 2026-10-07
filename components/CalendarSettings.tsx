"use client";
import { useEffect, useRef, useState } from "react";
import { parseICS, type CalendarAccess, type IcsEvent } from "@/lib/calendar";
import { syncPhoneCalendar } from "@/lib/calendarSync";
import { askCalendarAccess, calendarAccess } from "@/lib/nativeBridge";
import { isNative } from "@/lib/platform";
import type { Profile } from "@/lib/types";
import { ImportSheet } from "./ImportSheet";
import { btn, type ViewCtx } from "./ui";

/** Settings → Calendar: read the phone's calendar (read-only), and add events from an .ics file. */
export function CalendarSettings({ p, set, syncedAt, ctx }: { p: Profile; set: <K extends keyof Profile>(k: K, v: Profile[K]) => void; syncedAt?: number; ctx: ViewCtx }) {
  const [access, setAccess] = useState<CalendarAccess>("unsupported");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [imported, setImported] = useState<IcsEvent[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = isNative();

  useEffect(() => {
    calendarAccess().then(setAccess);
  }, []);

  const sync = async () => {
    setBusy(true);
    setMsg("");
    const r = await syncPhoneCalendar({ ask: true });
    setAccess(await calendarAccess());
    setMsg(r === "ok" ? "Calendar read. Your events are in the plan." : r === "no-permission" ? "Calendar access isn't allowed yet." : r === "error" ? "Couldn't read the calendar." : "");
    setBusy(false);
  };

  const allow = async () => {
    setBusy(true);
    const a = await askCalendarAccess();
    setAccess(a);
    if (a === "granted") await syncPhoneCalendar();
    else setMsg("Android didn't allow it. You can switch Calendar on in Settings → Apps → Today → Permissions.");
    setBusy(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const events = parseICS(await file.text());
    setImported(events);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      {native ? (
        <>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={p.calendarSync} onChange={(e) => set("calendarSync", e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
            Show events from my phone's calendar
          </label>
          <p className="text-sm text-muted">
            Events from Google Calendar, Gmail invites and anything else on your phone appear as fixed blocks, and sessions reshuffle around them. Read-only and offline: nothing is changed or sent anywhere.
          </p>
          <p className="text-sm">
            <span className="text-muted">Access: </span>
            <span className="font-medium">{access === "granted" ? "allowed" : access === "denied" ? "not allowed" : "not asked yet"}</span>
            {syncedAt ? <span className="text-muted"> · last read {new Date(syncedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span> : null}
          </p>
          <div className="flex gap-2">
            {access !== "granted" && (
              <button type="button" className={`${btn.primary} min-h-11 flex-1`} disabled={busy} onClick={allow}>
                Allow calendar access
              </button>
            )}
            <button type="button" className={`${btn.soft} min-h-11 flex-1`} disabled={busy || !p.calendarSync} onClick={sync}>
              {busy ? "Reading…" : "Read it now"}
            </button>
          </div>
          {msg && (
            <p className="text-sm text-muted" role="status">
              {msg}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">Reading your phone's calendar works in the Android app. Here, you can still add events from an invite file.</p>
      )}
      <div>
        <button type="button" className={`${btn.ghost} min-h-11 w-full`} onClick={() => fileRef.current?.click()}>
          Add events from an .ics file
        </button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <p className="mt-1 text-xs text-muted">On the phone you can also tap an invite anywhere and choose “Today”.</p>
      </div>
      {imported && <ImportSheet events={imported} ctx={ctx} onClose={() => setImported(null)} />}
    </div>
  );
}
