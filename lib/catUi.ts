import { categorise, catCtx } from "./categorise";
import { categoryOfEvent, categoryOfTask } from "./entries";
import { eventMarkKey } from "./fixed";
import { cached } from "./memo";
import { findTask } from "./series";
import type { TLItem } from "./timeline";
import type { AppData, Category, FixedEvent, Task } from "./types";

/** What a category chip needs: the key a pick is stored under, the title it teaches, the category, and whether you can change it. */
export interface ChipTarget {
  key: string;
  title: string;
  cat: Category;
  editable: boolean;
}

// A chip is worked out once per data snapshot and item, however often its row re-renders.
export function chipForTask(data: AppData, t: Task): ChipTarget {
  return cached(data, `chip:task:${t.id}:${t.title}:${t.area ?? ""}`, () => ({ key: t.seriesId ? `occ:${t.id}` : `task:${t.id}`, title: t.title, cat: categoryOfTask(data, t), editable: true }));
}

export function chipForEvent(data: AppData, e: FixedEvent): ChipTarget {
  return cached(data, `chip:event:${eventMarkKey(e)}:${e.title}`, () => ({ key: `event:${eventMarkKey(e)}`, title: e.title, cat: categoryOfEvent(data, e), editable: true }));
}

/** The chip for a row of Today's timeline. null = nothing to categorise (breaks, the commute, a cleared stretch). */
export function chipForTL(data: AppData, it: TLItem): ChipTarget | null {
  return cached(data, `chip:tl:${it.key}:${it.title}`, () => tlChip(data, it));
}

function tlChip(data: AppData, it: TLItem): ChipTarget | null {
  if (it.muted || it.clearedId || it.blockId) return null;
  if (it.taskId) {
    const t = findTask(data, it.taskId);
    return t ? chipForTask(data, t) : null;
  }
  if (it.kind === "session" && it.areaId) return { key: it.key, title: it.title, cat: categorise({ title: it.title, area: it.areaId, inherited: true }, catCtx(data)), editable: false };
  if (it.eventId) {
    const e = [...(data.events ?? []), ...(data.calendarEvents ?? [])].find((x) => x.id === it.eventId || (it.eventKey && eventMarkKey(x) === it.eventKey));
    if (e) return chipForEvent(data, e);
  }
  if (it.kind === "bill" || it.kind === "chore") return { key: it.key, title: it.title, cat: categorise({ key: it.key, title: it.title }, catCtx(data)), editable: true };
  return null;
}
