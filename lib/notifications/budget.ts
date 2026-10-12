import { toISO } from "../dates";
import type { PlannedNotification } from "./plan";

/**
 * "Few but worth it." At most DAILY_BUDGET notifications a day, not counting what has a fixed time of its own (a reminder
 * at 11:00, a bill, an event, a timer). When a day has more, the lowest-value nudges are dropped first.
 */
export const DAILY_BUDGET = 5;

/** What has its own fixed time: never counted, never dropped. */
const EXEMPT = new Set<string>(["reminder", "event", "bill", "timer", "eventprep"]);

/** How much a notification is worth (higher stays). The gentle daily pings are worth least. */
export function valueOf(n: Pick<PlannedNotification, "kind" | "key" | "value">): number {
  if (n.value != null) return n.value;
  switch (n.kind) {
    case "tonight":
      return 90;
    case "wrap":
      return 85;
    case "morning":
      return 80;
    // A quote is its own small promise (it once never arrived), so it outranks a session nudge. Session nudges carry their
    // own value: the further behind the area, the higher.
    case "quote":
      return 75;
    case "session":
      return 70;
    case "review":
    case "sofar":
      return 78;
    case "life":
      return 55;
    case "chore":
      return 50;
    case "slot":
      return 45;
    case "checkin":
      return 40;
    case "nudge":
      // The daily "conscience" nudge is worth more than the rhythm pings (midday check, wrap up work).
      return n.key.startsWith("rhythm:") ? 20 : 30;
    default:
      return 10;
  }
}

export const isExempt = (n: Pick<PlannedNotification, "kind">) => EXEMPT.has(n.kind);

/** The list with each day cut down to the budget. Order is kept. */
export function applyBudget(list: PlannedNotification[], budget = DAILY_BUDGET): PlannedNotification[] {
  const byDay = new Map<string, PlannedNotification[]>();
  for (const n of list) {
    if (isExempt(n)) continue;
    const day = toISO(n.at);
    const g = byDay.get(day);
    if (g) g.push(n);
    else byDay.set(day, [n]);
  }
  const drop = new Set<string>();
  for (const g of byDay.values()) {
    if (g.length <= budget) continue;
    const ranked = [...g].sort((a, b) => valueOf(b) - valueOf(a) || a.at.getTime() - b.at.getTime());
    for (const n of ranked.slice(budget)) drop.add(n.key);
  }
  return drop.size ? list.filter((n) => !drop.has(n.key)) : list;
}
