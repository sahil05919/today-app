"use client";
import { useEffect, useRef, useState } from "react";
import { parseICS, type CalendarAccess, type IcsEvent } from "@/lib/calendar";
import { syncPhoneCalendar } from "@/lib/calendarSync";
import { askCalendarAccess, askCalendarWriteAccess, calendarAccess, calendarWriteAccess, listWritableCalendars, type WritableCalendar } from "@/lib/nativeBridge";
import { pickDefaultCalendar } from "@/lib/calendarWrite";
import { findTodayCalendar, INBOX_HELP, INBOX_NAME, PICK_PLAN, PLAN_HELP, PLAN_NAME } from "@/lib/calendarNames";
import { inboxStatusLines } from "@/lib/inbox";
import { checkInboxNow } from "@/lib/inboxRun";
import { useData } from "@/lib/store";
import { isNative } from "@/lib/platform";
import type { Profile } from "@/lib/types";
import { ImportSheet } from "./ImportSheet";
import { btn, field, type ViewCtx } from "./ui";

/** Settings → Calendar: read the phone's calendar (read-only), and add events from an .ics file. */
export function CalendarSettings({ p, set, syncedAt, ctx }: { p: Profile; set: <K extends keyof Profile>(k: K, v: Profile[K]) => void; syncedAt?: number; ctx: ViewCtx }) {
  const [access, setAccess] = useState<CalendarAccess>("unsupported");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [imported, setImported] = useState<IcsEvent[] | null>(null);
  const [writeAccess, setWriteAccess] = useState<CalendarAccess>("unsupported");
  const [calendars, setCalendars] = useState<WritableCalendar[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = isNative();
  const data = useData();
  const mirror = data?.settings.mirror;
  const planFound = findTodayCalendar(calendars, "plan", p.planCalendarId);
  const inboxFound = findTodayCalendar(calendars, "inbox", p.inboxCalendarId);
  const mirrorLine = !p.planMirror
    ? "Off"
    : writeAccess !== "granted"
      ? "Needs permission to add to your calendar"
      : !planFound.cal
        ? PLAN_HELP
        : mirror?.status === "pick-calendar"
          ? PICK_PLAN
          : mirror?.status === "ok"
          ? `On · ${planFound.cal.name} · updated ${new Date(mirror.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : mirror?.status === "error"
            ? "Couldn't update it. See Health → Recent errors"
            : `Found “${planFound.cal.name}”. It updates in a moment`;

  useEffect(() => {
    calendarAccess().then(setAccess);
    calendarWriteAccess().then(async (a) => {
      setWriteAccess(a);
      if (a === "granted") setCalendars((await listWritableCalendars()) ?? []);
    });
  }, []);

  const allowWrite = async () => {
    setBusy(true);
    const a = await askCalendarWriteAccess();
    setWriteAccess(a);
    setAccess(await calendarAccess());
    if (a === "granted") setCalendars((await listWritableCalendars()) ?? []);
    else setMsg("Android didn't allow it. You can switch Calendar on in Settings → Apps → Today → Permissions.");
    setBusy(false);
  };
  const target = calendars.find((c) => String(c.id) === p.writeCalendarId) ?? pickDefaultCalendar(calendars);

  const checkInbox = async () => {
    setBusy(true);
    setMsg("");
    const r = await checkInboxNow();
    setAccess(await calendarAccess());
    setWriteAccess(await calendarWriteAccess());
    setMsg(r.status === "ok" ? (r.added ? `${r.added} ${r.added === 1 ? "task" : "tasks"} added from Gmail.` : "Checked. Nothing new.") : "");
    setBusy(false);
  };

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
      {native && (
        <div className="space-y-2 rounded-2xl border border-line p-3">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={p.calendarWrite} onChange={(e) => set("calendarWrite", e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
            Also put events I create here into my calendar
          </label>
          <p className="text-xs text-muted">Events you type (“event …”) or confirm from an email are written to the calendar below, so they reach Google Calendar. Routine sessions are never written. Ticks and hides on phone events stay in Today.</p>
          {p.calendarWrite && writeAccess !== "granted" && (
            <button type="button" className={`${btn.primary} min-h-11 w-full`} disabled={busy} onClick={allowWrite}>
              Allow adding to my calendar
            </button>
          )}
          {p.calendarWrite && writeAccess === "granted" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Calendar</span>
              <select value={target ? String(target.id) : ""} onChange={(e) => set("writeCalendarId", e.target.value || undefined)} className={field} disabled={!calendars.length}>
                {!calendars.length && <option value="">No calendar found</option>}
                {calendars.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}{c.account && c.account !== c.name ? ` (${c.account})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {native && (
        <div className="space-y-2 rounded-2xl border border-line p-3">
          <p className="text-sm font-medium">Gmail inbox</p>
          <p className="text-xs text-muted">The Gmail add-on sends tasks as all-day “TASK: …” events in a calendar named “{INBOX_NAME}”. Today picks them up when it opens and when you come back to it.</p>
          <ul className="space-y-0.5 text-sm" role="status">
            {inboxStatusLines(data?.settings.inboxCheck).map((l, i) => (
              <li key={i} className={i === 0 ? "text-muted" : ""}>
                {l}
              </li>
            ))}
          </ul>
          <button type="button" className={`${btn.soft} min-h-11 w-full`} disabled={busy} onClick={checkInbox}>
            {busy ? "Checking…" : "Check Gmail inbox now"}
          </button>
        </div>
      )}
      {native && (
        <div className="space-y-2 rounded-2xl border border-line p-3">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={p.planMirror} onChange={(e) => set("planMirror", e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
            Plan mirror: keep a safety copy of my next 7 days in Google Calendar
          </label>
          <p className="text-xs text-muted">
            Writes the next 7 days (sessions, tasks, life admin) to a Google calendar named “{PLAN_NAME}”, with ✓ when done. Edits made there are overwritten. After a crash or a reinstall your schedule is still in Google. Past days keep their final ✓ / ✗ as your history. Tip: set that calendar's notifications to “None” in Google Calendar so you are not alerted twice.
          </p>
          <p className="text-sm" role="status">
            <span className="text-muted">Status: </span>
            <span className="font-medium">{mirrorLine}</span>
          </p>
          {p.planMirror && writeAccess !== "granted" && (
            <button type="button" className={`${btn.primary} min-h-11 w-full`} disabled={busy} onClick={allowWrite}>
              Allow adding to my calendar
            </button>
          )}
          {p.planMirror && writeAccess === "granted" && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Plan calendar</span>
                <select value={p.planCalendarId ?? ""} onChange={(e) => set("planCalendarId", e.target.value || undefined)} className={field}>
                  <option value="">Automatic: find “{PLAN_NAME}” by name</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}{c.account && c.account !== c.name ? ` (${c.account})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Inbox calendar (the Gmail add-on writes tasks here)</span>
                <select value={p.inboxCalendarId ?? ""} onChange={(e) => set("inboxCalendarId", e.target.value || undefined)} className={field}>
                  <option value="">Automatic: find “{INBOX_NAME}” by name</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}{c.account && c.account !== c.name ? ` (${c.account})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {!inboxFound.cal && <p className="text-xs text-muted">{INBOX_HELP}</p>}
            </>
          )}
        </div>
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
