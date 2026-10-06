"use client";
import { useState } from "react";
import { builtInShortcuts } from "@/lib/profile";
import { actions } from "@/lib/store";
import type { Area, Profile } from "@/lib/types";
import { NotificationSettings } from "./NotificationSettings";
import { btn, field, Sheet, type ViewCtx } from "./ui";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DayChips({ value, onChange, label }: { value: number[]; onChange: (v: number[]) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {DAY_ORDER.map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className={`min-h-11 min-w-11 rounded-xl border px-2 text-sm font-medium ${
              on ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg text-muted"
            }`}
          >
            {DAY_NAME[d]}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const Time = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
  <Field label={label}>
    <input type="time" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className={field} />
  </Field>
);

const Mins = ({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) => (
  <Field label={label}>
    <input
      type="number"
      min={0}
      max={240}
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(Math.max(0, Math.min(240, parseInt(e.target.value, 10) || 0)))}
      className={field}
    />
  </Field>
);

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "area";

/** "Me": set up once, editable any time. Everything is stored on this phone. */
export function ProfileSheet({ profile, ctx, onClose }: { profile: Profile; ctx: ViewCtx; onClose: () => void }) {
  const [p, setP] = useState<Profile>(profile);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const first = !profile.setupDone;

  const save = () => {
    actions.setProfile({ ...p, setupDone: true });
    ctx.notify("Saved. Today now works around your day.");
    onClose();
  };
  const skip = () => {
    actions.setProfile({ ...profile, setupDone: true });
    onClose();
  };

  const updateArea = (i: number, patch: Partial<Area>) => set("areas", p.areas.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const addArea = () => {
    const name = "New area";
    set("areas", [...p.areas, { id: slug(name) + "-" + (p.areas.length + 1), name, emoji: "⭐" }]);
  };
  const [phrase, setPhrase] = useState("");
  const [phraseTime, setPhraseTime] = useState("18:00");

  return (
    <Sheet title={first ? "Let's set up Me" : "Me"} onClose={first ? skip : onClose}>
      <div className="space-y-7 pb-2">
        <p className="-mt-1 text-sm text-muted">
          Tell Today about your day once. It uses this to plan around work, keep quiet when you're busy, and understand your own phrases. All of it
          stays on this phone.
        </p>

        <Section title="Work">
          <DayChips label="Work days" value={p.workDays} onChange={(v) => set("workDays", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Time label="Start" value={p.workStart} onChange={(v) => set("workStart", v)} />
            <Time label="Finish" value={p.workEnd} onChange={(v) => set("workEnd", v)} />
            <Time label="Lunch starts" value={p.lunchStart} onChange={(v) => set("lunchStart", v)} />
            <Mins label="Lunch (minutes)" value={p.lunchMin} onChange={(v) => set("lunchMin", v)} />
            <Mins label="Commute to work (min)" value={p.commuteToMin} onChange={(v) => set("commuteToMin", v)} />
            <Mins label="Commute home (min)" value={p.commuteFromMin} onChange={(v) => set("commuteFromMin", v)} />
          </div>
        </Section>

        <Section title="Focus and fitness">
          <Field label="When do you focus best?">
            <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="group" aria-label="Best focus time">
              {(["morning", "afternoon", "evening"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={p.bestFocus === f}
                  onClick={() => set("bestFocus", f)}
                  className={`min-h-11 flex-1 rounded-lg capitalize ${p.bestFocus === f ? "bg-surface shadow-sm" : "text-muted"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Gym days">
            <DayChips label="Gym days" value={p.gymDays} onChange={(v) => set("gymDays", v)} />
          </Field>
          {p.gymDays.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Time label="Gym starts" value={p.gymStart} onChange={(v) => set("gymStart", v)} />
              <Mins label="Gym (minutes)" value={p.gymMin} onChange={(v) => set("gymMin", v)} />
            </div>
          )}
        </Section>

        <Section title="Check-in times" hint="Quiet hours: no notifications. Work hours: only for tasks in a Work area.">
          <div className="grid grid-cols-2 gap-3">
            <Time label="Morning check-in" value={p.morningCheckIn} onChange={(v) => set("morningCheckIn", v)} />
            <Time label="Task check-ins" value={p.taskCheckIn} onChange={(v) => set("taskCheckIn", v)} />
            <Time label="Evening wrap-up" value={p.eveningWrap} onChange={(v) => set("eveningWrap", v)} />
            <span />
            <Time label="Quiet from" value={p.quietStart} onChange={(v) => set("quietStart", v)} />
            <Time label="Quiet until" value={p.quietEnd} onChange={(v) => set("quietEnd", v)} />
          </div>
        </Section>

        <Section title="Life areas" hint="Tag a task by typing @family, or pick one in the task. “Counts as work” lets its reminders through during your shift.">
          <ul className="space-y-2">
            {p.areas.map((a, i) => (
              <li key={a.id} className="rounded-2xl border border-line bg-bg p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    value={a.emoji}
                    onChange={(e) => updateArea(i, { emoji: e.target.value.slice(0, 4) })}
                    aria-label="Emoji"
                    className={`${field} w-14 text-center`}
                  />
                  <input value={a.name} onChange={(e) => updateArea(i, { name: e.target.value.slice(0, 30) })} aria-label="Area name" className={field} />
                  <button
                    type="button"
                    onClick={() => set("areas", p.areas.filter((_, k) => k !== i))}
                    aria-label={`Remove ${a.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-1 text-xs text-muted">
                  <label className="flex min-h-9 items-center gap-1.5">
                    <input type="checkbox" checked={!!a.isWork} onChange={(e) => updateArea(i, { isWork: e.target.checked || undefined })} className="accent-[var(--accent)]" />
                    Counts as work
                  </label>
                  <label className="flex min-h-9 items-center gap-1.5">
                    <input type="checkbox" checked={!!a.balance} onChange={(e) => updateArea(i, { balance: e.target.checked || undefined })} className="accent-[var(--accent)]" />
                    Nudge me to keep some in my week
                  </label>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className={`${btn.ghost} min-h-11`} onClick={addArea}>
            + Add an area
          </button>
        </Section>

        <Section title="My phrases" hint="Your own words for times of day. Use them when you capture, like “kal office ke baad call mum”.">
          <ul className="space-y-1.5 text-sm">
            {[...p.shortcuts.map((s, i) => ({ ...s, custom: i })), ...builtInShortcuts(p).filter((s) => !/[^\x00-\x7F]/.test(s.phrase)).map((s) => ({ ...s, custom: -1 }))].map((s, k) => (
              <li key={k} className="flex min-h-9 items-center gap-2 rounded-xl bg-bg px-3">
                <span className="min-w-0 flex-1 truncate">“{s.phrase}”</span>
                <span className="tabular-nums text-muted">{s.time}</span>
                {s.custom >= 0 ? (
                  <button type="button" aria-label={`Remove ${s.phrase}`} onClick={() => set("shortcuts", p.shortcuts.filter((_, j) => j !== s.custom))} className="px-1 text-muted">
                    ✕
                  </button>
                ) : (
                  <span className="w-5" />
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!phrase.trim()) return;
              set("shortcuts", [...p.shortcuts, { phrase: phrase.trim(), time: phraseTime }]);
              setPhrase("");
            }}
          >
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="e.g. nashte ke baad" className={field} aria-label="Phrase" />
            <input type="time" value={phraseTime} onChange={(e) => e.target.value && setPhraseTime(e.target.value)} className={`${field} w-28`} aria-label="Time" />
            <button type="submit" className={`${btn.soft} min-h-11`} disabled={!phrase.trim()}>
              Add
            </button>
          </form>
        </Section>

        <Section title="Notifications">
          <NotificationSettings notify={p.notify} onChange={(n) => set("notify", n)} ctx={ctx} />
        </Section>

        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-line bg-surface px-5 py-3">
          <button className={`${btn.primary} min-h-12 flex-1`} onClick={save}>
            {first ? "Save and start" : "Save"}
          </button>
          {first && (
            <button className={`${btn.ghost} min-h-12`} onClick={skip}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
