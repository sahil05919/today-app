import { capacityOf, MIN_DAYS } from "./capacity";
import { buildChoice, type TickHint } from "./feeling";
import { toISO } from "./dates";
import type { AppData, Energy, ISODate } from "./types";

const DAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const ENERGY_WORD: Record<Energy, string> = { low: "low", ok: "okay", high: "great" };

/**
 * What the morning check-in pre-ticks, from what he really finishes (needs at least 10 days of history).
 * Before that: `progress` says "Learning your rhythm · 6 of 10 days".
 */
export function tickHint(data: AppData, now: Date, energy: Energy): { hint: TickHint | null; progress?: string } {
  const today = toISO(now);
  const cap = capacityOf(data, today);
  if (!cap.enough) return { hint: null, progress: `Learning your rhythm · ${cap.days} of ${MIN_DAYS} days` };
  const dow = now.getDay();
  const wd = cap.weekday[dow];
  const byDay = wd.days >= 2 ? wd.typical : null;
  const byEnergy = cap.byEnergy[energy].days >= 3 ? cap.byEnergy[energy].typical : null;
  const base = byDay != null && byEnergy != null ? (byDay + byEnergy) / 2 : (byDay ?? byEnergy ?? cap.overall);
  if (base == null) return { hint: null };
  const count = Math.max(1, Math.round(base));
  const note =
    byDay != null
      ? `You usually finish about ${count} on ${DAY[dow]}${energy !== "ok" && byEnergy != null ? `, and ${ENERGY_WORD[energy]} days are a bit different` : ""}.`
      : byEnergy != null
        ? `On ${ENERGY_WORD[energy]} days you usually finish about ${count}.`
        : `You usually finish about ${count} a day.`;
  return { hint: { count, note } };
}

export interface Overload {
  planned: number;
  typical: number;
  message: string;
}

/**
 * Is today clearly more than he usually finishes? Only once there's enough history. "Clearly" = at least two more than
 * a typical day and a third more than it. Returns null on a normal day.
 */
export function overload(data: AppData, now: Date, today: ISODate = toISO(now)): Overload | null {
  const cap = capacityOf(data, today);
  if (!cap.enough) return null;
  const wd = cap.weekday[now.getDay()];
  const typical = wd.days >= 2 && wd.typical != null ? wd.typical : cap.overall;
  if (typical == null) return null;
  const planned = buildChoice(data, now, "ok").items.filter((i) => !i.locked).length;
  const t = Math.max(1, Math.round(typical));
  if (planned < t + 2 || planned < t * 1.33) return null;
  return { planned, typical: t, message: `Today has ${planned} things planned, and you usually finish about ${t} on ${DAY[now.getDay()]}.` };
}
