import { categorise, catCtx } from "./categorise";
import type { AppData, Category, HistoryEvent } from "./types";

/**
 * History entries carry the category they had when they were written, so a search months later (after the item is gone, or the
 * raw history has been archived) still knows what each one was. Only the dictionary is used here: never the network.
 */
const stored = (e: HistoryEvent): Category | null =>
  e.cat ? { ...e.cat, how: e.cat.conf === "high" ? "explicit" : e.cat.conf === "medium" ? "dictionary" : "fallback" } : null;

/** A history entry's category: the saved one, else worked out now. */
export function historyCategory(data: AppData, e: HistoryEvent): Category {
  const saved = stored(e);
  if (saved) return saved;
  const inherited = (e.type === "session" || e.type === "bill" || e.type === "routine") && !!e.area;
  return categorise({ key: e.key, title: e.title, area: e.area, inherited }, catCtx(data));
}

/** `events` with their category (and the area, when they had none) filled in. Entries that already have one are left alone (idempotent). */
export function annotateHistory(events: HistoryEvent[], data: AppData): HistoryEvent[] {
  let changed = false;
  const out = events.map((e) => {
    if (e.cat) return e;
    changed = true;
    const c = historyCategory(data, e);
    return { ...e, cat: { area: c.area, sub: c.sub, conf: c.conf } };
  });
  return changed ? out : events;
}
