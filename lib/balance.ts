import { addDays } from "./dates";
import { withDefaults } from "./profile";
import { weekStart } from "./stats";
import type { AppData, ISODate } from "./types";
import { toISO } from "./dates";

export interface BalanceNudge {
  message: string;
  /** Area ids with nothing in them this week that you'd like some of (Family, Fun, Health…). */
  missing: string[];
}

/**
 * "All work this week, nothing in Family or Fun." Looks at this week's tasks that have a life area
 * (planned or finished). Needs a few tagged tasks before it says anything.
 */
export function balanceNudge(data: AppData, today: ISODate): BalanceNudge | null {
  const p = withDefaults(data.profile);
  const start = weekStart(today);
  const end = addDays(start, 6);
  const inWeek = data.tasks.filter((t) => {
    if (!t.area || t.area === "others") return false; // untagged and "Others" say nothing about balance
    const d = t.status === "done" && t.completedAt ? toISO(new Date(t.completedAt)) : t.due;
    return !!d && d >= start && d <= end;
  });
  if (inWeek.length < 4) return null;

  const count = new Map<string, number>();
  for (const t of inWeek) count.set(t.area!, (count.get(t.area!) ?? 0) + 1);
  const workIds = new Set(p.areas.filter((a) => a.isWork).map((a) => a.id));
  const work = inWeek.filter((t) => workIds.has(t.area!)).length;
  const share = work / inWeek.length;
  const missing = p.areas.filter((a) => a.balance && !count.get(a.id));
  if (share < 0.7 || !missing.length) return null;

  const names = missing.map((a) => a.name).join(" or ");
  return {
    message: share === 1 ? `All work this week, nothing in ${names}.` : `Mostly work this week (${Math.round(share * 100)}%), nothing in ${names}.`,
    missing: missing.map((a) => a.id),
  };
}
