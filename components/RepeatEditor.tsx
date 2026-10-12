"use client";
import { fromISO } from "@/lib/dates";
import { recurLabel } from "@/lib/recur";
import type { ISODate, Recurrence } from "@/lib/types";
import { field } from "./ui";

export type RepeatKind = "none" | "daily" | "weekdays" | "weekly" | "every" | "monthly";

const WEEKDAYS = [1, 2, 3, 4, 5];
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Which of the simple choices a rule is. */
export function repeatKind(r?: Recurrence): RepeatKind {
  if (!r) return "none";
  const wd = r.weekdays ?? [];
  if (r.freq === "daily") return r.interval > 1 ? "every" : "daily";
  if (r.freq === "monthly") return "monthly";
  if (r.interval === 1 && wd.length === 5 && WEEKDAYS.every((d) => wd.includes(d))) return "weekdays";
  return "weekly";
}

/** A sensible rule for a choice, counted from `anchor` (the day this task is on). */
export function ruleFor(kind: RepeatKind, anchor: ISODate, keep?: Recurrence): Recurrence | undefined {
  const d = fromISO(anchor);
  if (kind === "none") return undefined;
  if (kind === "daily") return { freq: "daily", interval: 1 };
  if (kind === "weekdays") return { freq: "weekly", interval: 1, weekdays: WEEKDAYS };
  if (kind === "weekly") return { freq: "weekly", interval: keep?.freq === "weekly" ? keep.interval : 1, weekdays: keep?.freq === "weekly" && keep.weekdays?.length ? keep.weekdays : [d.getDay()] };
  if (kind === "every") return { freq: "daily", interval: keep?.freq === "daily" && keep.interval > 1 ? keep.interval : 3 };
  return { freq: "monthly", interval: 1, monthDay: keep?.freq === "monthly" && keep.monthDay ? keep.monthDay : d.getDate() };
}

/**
 * Choose how a task repeats: every day, weekdays, weekly on chosen days, every N days, or monthly on day N.
 * Gives back a rule, or null for "doesn't repeat".
 */
export function RepeatEditor({ rule, anchor, onChange }: { rule?: Recurrence; anchor: ISODate; onChange: (r: Recurrence | null) => void }) {
  const kind = repeatKind(rule);
  return (
    <div className="space-y-2">
      <select
        id="repeat"
        value={kind}
        onChange={(e) => onChange(ruleFor(e.target.value as RepeatKind, anchor, rule) ?? null)}
        className={field}
        aria-label="Repeat"
      >
        <option value="none">Doesn't repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Weekdays (Mon–Fri)</option>
        <option value="weekly">Weekly, on chosen days</option>
        <option value="every">Every N days</option>
        <option value="monthly">Monthly, on day N</option>
      </select>

      {kind === "weekly" && rule && (
        <div className="flex justify-between gap-1" role="group" aria-label="Days of the week">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = (rule.weekdays ?? []).includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={NAMES[d]}
                onClick={() => {
                  const cur = rule.weekdays ?? [];
                  const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                  if (next.length) onChange({ ...rule, weekdays: next.sort((a, b) => a - b) });
                }}
                className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold ${on ? "bg-accent text-accent-ink" : "border border-line bg-bg text-muted"}`}
              >
                {LETTERS[d]}
              </button>
            );
          })}
        </div>
      )}

      {kind === "every" && rule && (
        <label className="flex items-center gap-2 text-sm">
          Every
          <input
            type="number"
            min={2}
            max={365}
            inputMode="numeric"
            value={rule.interval}
            onChange={(e) => onChange({ ...rule, interval: Math.min(365, Math.max(2, parseInt(e.target.value, 10) || 2)) })}
            className={`${field} w-24`}
            aria-label="Number of days"
          />
          days
        </label>
      )}

      {kind === "monthly" && rule && (
        <label className="flex items-center gap-2 text-sm">
          On day
          <input
            type="number"
            min={1}
            max={31}
            inputMode="numeric"
            value={rule.monthDay ?? fromISO(anchor).getDate()}
            onChange={(e) => onChange({ ...rule, monthDay: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            className={`${field} w-24`}
            aria-label="Day of the month"
          />
          of the month
        </label>
      )}

      {rule && <p className="text-xs text-muted">{recurLabel(rule)}</p>}
    </div>
  );
}
