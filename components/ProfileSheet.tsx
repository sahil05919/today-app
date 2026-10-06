"use client";
import { useState } from "react";
import { buildPrompt, callGemini, DEFAULT_MODEL, getGeminiKey, getGeminiModel, setGeminiKey, setGeminiModel } from "@/lib/ai";
import { builtInShortcuts } from "@/lib/profile";
import { actions } from "@/lib/store";
import type { Area, AreaTarget, Bill, Profile, RhythmItem, Slot } from "@/lib/types";
import { NotificationSettings } from "./NotificationSettings";
import { btn, field, Sheet, type ViewCtx } from "./ui";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function DayChips({ value, onChange, label, small }: { value: number[]; onChange: (v: number[]) => void; label: string; small?: boolean }) {
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
            className={`${small ? "min-h-9 min-w-10 text-xs" : "min-h-11 min-w-11 text-sm"} rounded-xl border px-2 font-medium ${
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

const Num = ({ value, onChange, label, min = 0, max = 240 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number }) => (
  <Field label={label}>
    <input
      type="number"
      min={min}
      max={max}
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min)))}
      className={field}
    />
  </Field>
);

const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="flex min-h-10 items-center gap-2 text-sm">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
    {children}
  </label>
);

/** Collapsible, so Settings stays short until you open what you need. */
function Section({ title, hint, children, open }: { title: string; hint?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-2xl border border-line">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-[15px] font-semibold">{title}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
        <span className="text-muted transition group-open:rotate-90" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "item";
const newTarget = (): AreaTarget => ({ perWeek: 3, minutes: 30, weekends: false, slots: [], remind: true });

function TargetEditor({ target, slots, onChange }: { target: AreaTarget; slots: Slot[]; onChange: (t: AreaTarget) => void }) {
  const set = (patch: Partial<AreaTarget>) => onChange({ ...target, ...patch });
  return (
    <div className="mt-2 space-y-3 rounded-xl bg-surface p-3">
      <div className="grid grid-cols-2 gap-3">
        <Num label="Sessions per week" value={target.perWeek} min={1} max={14} onChange={(v) => set({ perWeek: v })} />
        <Num label="Minutes each" value={target.minutes} min={5} max={480} onChange={(v) => set({ minutes: v })} />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Best time of day (first choice first)</p>
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => {
            const idx = target.slots.indexOf(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={idx >= 0}
                onClick={() => set({ slots: idx >= 0 ? target.slots.filter((x) => x !== s.id) : [...target.slots, s.id] })}
                className={`min-h-10 rounded-xl border px-3 text-sm font-medium ${idx >= 0 ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg text-muted"}`}
              >
                {idx >= 0 ? `${idx + 1}. ` : ""}
                {s.name}
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Alternate names (optional)" hint="e.g. Job Prep, Job Apply. Sessions take turns.">
        <input
          defaultValue={target.variants?.join(", ") ?? ""}
          onBlur={(e) => {
            const v = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
            set({ variants: v.length ? v : undefined });
          }}
          className={field}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <Check checked={target.weekends} onChange={(v) => set({ weekends: v })}>
          Allow on weekends
        </Check>
        <Check checked={target.remind} onChange={(v) => set({ remind: v })}>
          Remind me at the start
        </Check>
      </div>
      <div className="flex items-end gap-3">
        <Check checked={!!target.at} onChange={(v) => set({ at: v ? (target.at ?? "19:30") : undefined })}>
          Start at a set time
        </Check>
        {target.at && <input type="time" value={target.at} onChange={(e) => e.target.value && set({ at: e.target.value })} className={`${field} w-32`} aria-label="Start time" />}
      </div>
    </div>
  );
}

/** Settings: set up once, editable any time. Everything is stored on this phone. */
export function ProfileSheet({ profile, bills, ctx, onClose }: { profile: Profile; bills: Bill[]; ctx: ViewCtx; onClose: () => void }) {
  const [p, setP] = useState<Profile>(profile);
  const [bs, setBs] = useState<Bill[]>(bills);
  const [aiKey, setAiKey] = useState(() => getGeminiKey());
  const [aiModel, setAiModel] = useState(() => getGeminiModel());
  const [aiTest, setAiTest] = useState<string>("");
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const first = !profile.setupDone;

  const save = () => {
    actions.setProfile({ ...p, setupDone: true });
    actions.setBills(bs);
    setGeminiKey(aiKey);
    setGeminiModel(aiModel);
    ctx.notify("Saved. Today now plans around you.");
    onClose();
  };
  const skip = () => {
    actions.setProfile({ ...profile, setupDone: true });
    onClose();
  };

  const updateArea = (i: number, patch: Partial<Area>) => set("areas", p.areas.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const addArea = () => set("areas", [...p.areas, { id: `area-${Date.now().toString(36)}`, name: "New area", emoji: "⭐" }]);
  const updateSlot = (i: number, patch: Partial<Slot>) => set("slots", p.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const updateRhythm = (i: number, patch: Partial<RhythmItem>) => set("rhythm", p.rhythm.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const [phrase, setPhrase] = useState("");
  const [phraseTime, setPhraseTime] = useState("18:00");

  return (
    <Sheet title={first ? "Let's get you set up" : "Settings"} onClose={first ? skip : onClose}>
      <div className="space-y-3 pb-2">
        <p className="-mt-1 text-sm text-muted">
          Everything here is editable, and it all stays on this phone. Open a section to change it.
        </p>

        <Section title="You" open={first}>
          <Field label="Your name" hint="Used in friendly reminders.">
            <input value={p.name} onChange={(e) => set("name", e.target.value.slice(0, 40))} className={field} />
          </Field>
          <Field label="Office days">
            <DayChips label="Office days" value={p.officeDays} onChange={(v) => set("officeDays", v)} />
          </Field>
        </Section>

        <Section title="Areas & weekly targets" hint="Sessions per week, counted automatically" open={first}>
          <ul className="space-y-2">
            {p.areas.map((a, i) => (
              <li key={a.id} className="rounded-2xl border border-line bg-bg p-2.5">
                <div className="flex items-center gap-2">
                  <input value={a.emoji} onChange={(e) => updateArea(i, { emoji: e.target.value.slice(0, 4) })} aria-label="Emoji" className={`${field} w-14 text-center`} />
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
                <div className="mt-1 flex flex-wrap gap-x-4 pl-1 text-xs text-muted">
                  <Check checked={!!a.target} onChange={(v) => updateArea(i, { target: v ? newTarget() : undefined })}>
                    Weekly sessions
                  </Check>
                  <Check checked={!!a.isWork} onChange={(v) => updateArea(i, { isWork: v || undefined })}>
                    Counts as work
                  </Check>
                </div>
                {a.target && <TargetEditor target={a.target} slots={p.slots} onChange={(t) => updateArea(i, { target: t })} />}
              </li>
            ))}
          </ul>
          <button type="button" className={`${btn.ghost} min-h-11`} onClick={addArea}>
            + Add an area
          </button>
          <p className="text-xs text-muted">Tag a task by typing @family. Unsure? It goes to Others.</p>
        </Section>

        <Section title="Daily rhythm" hint="Times of day and gentle check-ins">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">When sessions can happen</h4>
            <ul className="space-y-2">
              {p.slots.map((s, i) => (
                <li key={s.id} className="space-y-2 rounded-2xl bg-bg p-3">
                  <div className="flex items-center gap-2">
                    <input value={s.name} onChange={(e) => updateSlot(i, { name: e.target.value.slice(0, 30) })} aria-label="Slot name" className={field} />
                    <button type="button" aria-label={`Remove ${s.name}`} onClick={() => set("slots", p.slots.filter((_, k) => k !== i))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted">
                      ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Time label="From" value={s.start} onChange={(v) => updateSlot(i, { start: v })} />
                    <Time label="To" value={s.end} onChange={(v) => updateSlot(i, { end: v })} />
                  </div>
                  <DayChips small label={`${s.name} days`} value={s.days} onChange={(v) => updateSlot(i, { days: v })} />
                </li>
              ))}
            </ul>
            <button type="button" className={`${btn.ghost} mt-2 min-h-11`} onClick={() => set("slots", [...p.slots, { id: `slot-${Date.now().toString(36)}`, name: "New slot", start: "12:00", end: "13:00", days: EVERY_DAY }])}>
              + Add a time slot
            </button>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Check-ins</h4>
            <ul className="space-y-2">
              {p.rhythm.map((r, i) => (
                <li key={r.id} className="space-y-2 rounded-2xl bg-bg p-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => updateRhythm(i, { enabled: e.target.checked })} aria-label={`${r.label} on`} className="h-6 w-6 shrink-0 accent-[var(--accent)]" />
                    <input value={r.label} onChange={(e) => updateRhythm(i, { label: e.target.value.slice(0, 40) })} aria-label="Check-in name" className={field} />
                    <input type="time" value={r.time} onChange={(e) => e.target.value && updateRhythm(i, { time: e.target.value })} aria-label="Time" className={`${field} w-28 shrink-0`} />
                  </div>
                  <input value={r.message} onChange={(e) => updateRhythm(i, { message: e.target.value.slice(0, 200) })} aria-label="Message" className={field} />
                  <DayChips small label={`${r.label} days`} value={r.days} onChange={(v) => updateRhythm(i, { days: v })} />
                  <div className="flex items-center justify-between">
                    <Check checked={r.kind === "chore"} onChange={(v) => updateRhythm(i, { kind: v ? "chore" : "nudge" })}>
                      Ask until I tap Done
                    </Check>
                    <button type="button" onClick={() => set("rhythm", p.rhythm.filter((_, k) => k !== i))} className="min-h-10 px-2 text-sm text-warn">
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`${btn.ghost} mt-2 min-h-11`}
              onClick={() => set("rhythm", [...p.rhythm, { id: slug(`check-${Date.now().toString(36)}`), label: "New check-in", time: "12:00", days: EVERY_DAY, enabled: true, kind: "nudge", message: "Quick check-in, {name}." }])}
            >
              + Add a check-in
            </button>
            <p className="mt-2 text-xs text-muted">{"{name}"} becomes your name. Tracked check-ins get Done / Snooze / Skip buttons.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Time label="Morning briefing" value={p.morningCheckIn} onChange={(v) => set("morningCheckIn", v)} />
            <Time label="End-of-day check" value={p.eveningWrap} onChange={(v) => set("eveningWrap", v)} />
            <Time label="Daily nudge" value={p.nudgeTime} onChange={(v) => set("nudgeTime", v)} />
            <Time label="Sunday review" value={p.reviewTime} onChange={(v) => set("reviewTime", v)} />
            <Num label="Event heads-up (min before)" value={p.eventLeadMin} min={0} max={1440} onChange={(v) => set("eventLeadMin", v)} />
            <span />
            <Time label="Quiet from" value={p.quietStart} onChange={(v) => set("quietStart", v)} />
            <Time label="Quiet until" value={p.quietEnd} onChange={(v) => set("quietEnd", v)} />
          </div>
        </Section>

        <Section title="Bills & chores" hint="Reminders N days before, or none for autopay">
          <ul className="space-y-2">
            {bs.map((b, i) => {
              const upd = (patch: Partial<Bill>) => setBs((all) => all.map((x, k) => (k === i ? { ...x, ...patch } : x)));
              const s = b.schedule;
              return (
                <li key={b.id} className="space-y-2.5 rounded-2xl bg-bg p-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={b.enabled} onChange={(e) => upd({ enabled: e.target.checked })} aria-label={`${b.name} on`} className="h-6 w-6 shrink-0 accent-[var(--accent)]" />
                    <input value={b.name} onChange={(e) => upd({ name: e.target.value.slice(0, 60) })} aria-label="Name" className={field} />
                    <button type="button" aria-label={`Remove ${b.name}`} onClick={() => setBs((all) => all.filter((_, k) => k !== i))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted">
                      ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Repeats">
                      <select
                        value={s.type}
                        onChange={(e) =>
                          upd({ schedule: e.target.value === "monthly" ? { type: "monthly", day: 1 } : e.target.value === "weekly" ? { type: "weekly", dow: 6 } : { type: "every", days: 3 }, startDate: e.target.value === "every" ? (b.startDate ?? ctx.today) : b.startDate })
                        }
                        className={field}
                      >
                        <option value="monthly">Every month</option>
                        <option value="weekly">Every week</option>
                        <option value="every">Every few days</option>
                      </select>
                    </Field>
                    {s.type === "monthly" && <Num label="On day of month" value={s.day} min={1} max={31} onChange={(v) => upd({ schedule: { type: "monthly", day: v } })} />}
                    {s.type === "every" && <Num label="Every … days" value={s.days} min={1} max={365} onChange={(v) => upd({ schedule: { type: "every", days: v } })} />}
                    {s.type === "weekly" && (
                      <Field label="On">
                        <select value={s.dow} onChange={(e) => upd({ schedule: { type: "weekly", dow: Number(e.target.value) } })} className={field}>
                          {DAY_ORDER.map((d) => (
                            <option key={d} value={d}>
                              {DAY_NAME[d]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Field label="Remind (days before)" hint="e.g. 3 or 2, 0">
                      <input
                        defaultValue={b.remindDaysBefore.join(", ")}
                        onBlur={(e) =>
                          upd({
                            remindDaysBefore: [...new Set(e.target.value.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 31))].sort((a, c) => c - a),
                          })
                        }
                        inputMode="numeric"
                        className={field}
                      />
                    </Field>
                    <Time label="At" value={b.time} onChange={(v) => upd({ time: v })} />
                  </div>
                  <input value={b.note} onChange={(e) => upd({ note: e.target.value.slice(0, 200) })} aria-label="Reminder message" className={field} />
                  <div className="flex flex-wrap items-center gap-x-5">
                    <Check checked={b.autopay} onChange={(v) => upd({ autopay: v })}>
                      On autopay (never remind)
                    </Check>
                    <Check checked={b.kind === "chore"} onChange={(v) => upd({ kind: v ? "chore" : "bill" })}>
                      It's a chore
                    </Check>
                    <Check checked={!!b.groceries} onChange={(v) => upd({ groceries: v || undefined })}>
                      Reads out my shopping list
                    </Check>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={`${btn.ghost} min-h-11`}
            onClick={() =>
              setBs((all) => [...all, { id: `bill-${Date.now().toString(36)}`, name: "New bill", kind: "bill", schedule: { type: "monthly", day: 1 }, remindDaysBefore: [1], time: "18:00", autopay: false, enabled: true, note: "Reminder, {name}." }])
            }
          >
            + Add a bill or chore
          </button>
          <p className="text-xs text-muted">Rent is due on the 1st with a reminder 3 days before, so you can withdraw cash on the 28th or 29th.</p>
        </Section>

        <Section title="Work">
          <DayChips label="Work days" value={p.workDays} onChange={(v) => set("workDays", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Time label="Start" value={p.workStart} onChange={(v) => set("workStart", v)} />
            <Time label="Finish" value={p.workEnd} onChange={(v) => set("workEnd", v)} />
            <Time label="Lunch starts" value={p.lunchStart} onChange={(v) => set("lunchStart", v)} />
            <Num label="Lunch (minutes)" value={p.lunchMin} onChange={(v) => set("lunchMin", v)} />
            <Num label="Commute to work (min)" value={p.commuteToMin} onChange={(v) => set("commuteToMin", v)} />
            <Num label="Commute home (min)" value={p.commuteFromMin} onChange={(v) => set("commuteFromMin", v)} />
          </div>
          <p className="text-xs text-muted">During work hours only tasks in a “counts as work” area can ping you.</p>
        </Section>

        <Section title="Task planning" hint="For “Plan my tasks” and task check-ins">
          <Field label="When do you focus best?">
            <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="group" aria-label="Best focus time">
              {(["morning", "afternoon", "evening"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={p.bestFocus === f} onClick={() => set("bestFocus", f)} className={`min-h-11 flex-1 rounded-lg capitalize ${p.bestFocus === f ? "bg-surface shadow-sm" : "text-muted"}`}>
                  {f}
                </button>
              ))}
            </div>
          </Field>
          <Time label="Task check-ins" value={p.taskCheckIn} onChange={(v) => set("taskCheckIn", v)} />
        </Section>

        <Section title="My phrases" hint="Your own words for times of day">
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

        <Section title="Smart parsing (optional)" hint="Gemini fills gaps when the built-in rules are unsure">
          <p className="text-sm text-muted">
            Capture works fully offline with built-in rules. If you add a free Google AI Studio key, Gemini helps only when the rules can't find a date or an
            area, and falls back to the rules if you're offline or anything goes wrong.
          </p>
          <Field label="Gemini API key" hint="Stored on this phone only. Not in your backup file.">
            <input
              type="password"
              autoComplete="off"
              value={aiKey}
              onChange={(e) => {
                setAiKey(e.target.value);
                setAiTest("");
              }}
              placeholder="Paste your key (optional)"
              className={field}
            />
          </Field>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Advanced: model name</summary>
            <input value={aiModel} onChange={(e) => setAiModel(e.target.value)} className={`${field} mt-2`} aria-label="Model" />
            <p className="mt-1 text-xs text-muted">Default: {DEFAULT_MODEL}. If Google renames it, put the new name here.</p>
          </details>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={`${btn.soft} min-h-11`}
              disabled={!aiKey.trim()}
              onClick={async () => {
                setAiTest("Testing…");
                const r = await callGemini(buildPrompt("kal 6 baje mummy ko call karna hai", p.areas, ctx.today), { key: aiKey.trim(), model: aiModel.trim() || DEFAULT_MODEL });
                setAiTest(
                  r.ok
                    ? `Works. It read: ${JSON.stringify(r.result).slice(0, 110)}`
                    : { "bad-key": "Google didn't accept that key.", offline: "Couldn't reach Google. Are you online?", "rate-limit": "Free limit reached. Try again later.", failed: "That didn't work.", "no-key": "Paste a key first." }[r.reason],
                );
              }}
            >
              Test key
            </button>
            {aiTest && <span className="text-xs text-muted">{aiTest}</span>}
          </div>
          <p className="text-xs text-muted">When it's on, the text you type is sent to Google for those unsure notes. Leave the key empty to keep everything on the phone.</p>
        </Section>

        <Section title="Notifications" hint="Permissions, battery and what you want to hear about">
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
