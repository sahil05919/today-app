import { isCommandTitle } from "./intentPhrases";
import type { AppData, Occurrence, Recurrence, Series } from "./types";

/**
 * Keeping the data clean. Everything here is pure and idempotent: running it again changes nothing, so it runs on every load
 * (inside `migrate`) as well as in the morning self-check.
 *
 *  - `dedupeSeries`: two series with the same title + area + rule (and the same time, or one of them untimed) that overlap in
 *    time are ONE repeating task that was copied (an old generated copy, a migration that ran twice). They are merged into
 *    the oldest, keeping every done / skipped record.
 *  - `removeStrayTasks`: a command typed as if it were a task ("work done", "Can you take out some work from future…").
 */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export const ruleKey = (r: Recurrence) => `${r.freq}|${r.interval}|${[...(r.weekdays ?? [])].sort().join(",")}|${r.monthDay ?? ""}|${r.nth ?? ""}`;

const anchorOf = (s: Series) => s.anchor ?? s.startDate;
/** Two series count the same days only if their counting starts from the same place (unless they count every single day / week). */
const phase = (s: Series) => (s.rule.interval === 1 ? "" : anchorOf(s));

const overlaps = (a: Series, b: Series) => a.startDate <= (b.until ?? "9999-12-31") && b.startDate <= (a.until ?? "9999-12-31");

const rank = (r: Occurrence) => (r.status === "done" ? 4 : r.status === "skipped" ? 3 : r.movedTo ? 2 : r.status === "missed" ? 1 : 0);

export interface DedupeResult {
  data: AppData;
  /** Titles of the series that were merged away. */
  merged: string[];
}

export function dedupeSeriesReport(d: AppData): DedupeResult {
  const all = d.series ?? [];
  if (all.length < 2) return { data: d, merged: [] };

  const groups = new Map<string, Series[]>();
  for (const s of all) {
    const k = [norm(s.title), s.area ?? "", ruleKey(s.rule), phase(s), s.lifeId ?? ""].join("|");
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }

  /** series id → the series it was merged into */
  const into = new Map<string, Series>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => a.createdAt - b.createdAt || a.startDate.localeCompare(b.startDate));
    // Distinct clock times stay distinct; an untimed copy belongs with the timed one.
    const timed = ordered.filter((s) => s.time);
    const buckets: Series[][] = [];
    for (const s of ordered) {
      if (s.time) {
        const b = buckets.find((x) => x[0].time === s.time);
        if (b) b.push(s);
        else buckets.push([s]);
      }
    }
    for (const s of ordered) {
      if (s.time) continue;
      if (timed.length) buckets.find((x) => overlaps(x[0], s))?.push(s) ?? buckets.push([s]);
      else {
        const b = buckets.find((x) => !x[0].time);
        if (b) b.push(s);
        else buckets.push([s]);
      }
    }
    for (const bucket of buckets) {
      if (bucket.length < 2) continue;
      // Merge only the ones that overlap the keeper: a later series that continues an ended one is a different stretch.
      const keeper = [...bucket].sort((a, b) => a.createdAt - b.createdAt || a.startDate.localeCompare(b.startDate))[0];
      for (const other of bucket) if (other !== keeper && overlaps(keeper, other)) into.set(other.id, keeper);
    }
  }
  if (!into.size) return { data: d, merged: [] };

  const keepers = new Map<string, Series>();
  for (const [id, keeper] of into) {
    const cur = keepers.get(keeper.id) ?? keeper;
    const gone = all.find((s) => s.id === id)!;
    keepers.set(keeper.id, {
      ...cur,
      startDate: gone.startDate < cur.startDate ? gone.startDate : cur.startDate,
      until: !cur.until || !gone.until ? undefined : gone.until > cur.until ? gone.until : cur.until,
      // The copy may know more (a time, steps, notes); the keeper's own values win.
      time: cur.time ?? gone.time,
      notes: cur.notes ?? gone.notes,
      estimateMin: cur.estimateMin ?? gone.estimateMin,
      steps: cur.steps.length ? cur.steps : gone.steps,
      important: cur.important || gone.important,
      createdAt: Math.min(cur.createdAt, gone.createdAt),
    });
  }

  const series = all.filter((s) => !into.has(s.id)).map((s) => keepers.get(s.id) ?? s);

  // Records follow their series to the keeper; where both have one for a day the more meaningful one wins.
  const byKey = new Map<string, Occurrence>();
  for (const r of d.occurrences ?? []) {
    const target = into.get(r.seriesId);
    let rec = r;
    if (target) {
      const from = all.find((s) => s.id === r.seriesId)!;
      rec = { ...r, seriesId: target.id, key: `${target.id}@${r.date}` };
      // A time override that only existed because the copy had another time is not carried over.
      if (rec.time !== undefined && (from.time ?? "") !== (keepers.get(target.id)?.time ?? "")) delete rec.time;
    }
    const have = byKey.get(rec.key);
    if (!have || rank(rec) > rank(have)) byKey.set(rec.key, rec);
  }

  const timer = d.settings.timer;
  const timerId = timer?.taskId;
  const at = timerId ? timerId.lastIndexOf("@") : -1;
  const remapped = timerId && at > 0 && into.has(timerId.slice(0, at)) ? `${into.get(timerId.slice(0, at))!.id}${timerId.slice(at)}` : undefined;

  return {
    data: { ...d, series, occurrences: [...byKey.values()], settings: remapped ? { ...d.settings, timer: { ...timer!, taskId: remapped } } : d.settings },
    merged: [...into.keys()].map((id) => all.find((s) => s.id === id)!.title),
  };
}

export const dedupeSeries = (d: AppData): AppData => dedupeSeriesReport(d).data;

/** Open tasks whose title is a command phrase. They were never meant to be tasks. */
export function strayTasks(d: AppData): string[] {
  return d.tasks.filter((t) => t.status === "open" && !t.origin && isCommandTitle(t.title)).map((t) => t.id);
}

export function removeStrayTasks(d: AppData): AppData {
  const stray = new Set(strayTasks(d));
  return stray.size ? { ...d, tasks: d.tasks.filter((t) => !stray.has(t.id)) } : d;
}

/** Everything `migrate` and the self-check tidy up. */
export function cleanupData(d: AppData): AppData {
  return removeStrayTasks(dedupeSeries(d));
}
