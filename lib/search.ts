import { catCtx, OTHER } from "./categorise";
import { addDays, fromISO, toISO, weekdayShort } from "./dates";
import { buildEntries, type Entry } from "./entries";
import { fmtMinutes, otherEntriesBetween, otherWeek } from "./other";
import { parseQuery, type ParsedQuery } from "./query";
import { toHHMM, withDefaults } from "./profile";
import { planWeek } from "./schedule";
import { weekStart } from "./stats";
import { weekStats } from "./weekly";
import { bestStreaks, jarBetween } from "./winjar";
import type { AppData, AutoEntry, ISODate } from "./types";

/**
 * The search. The answer comes first (a card for the area you asked about, with numbers from the SAME functions as the weekly review:
 * `weekStats`, `jarBetween`, `otherEntriesBetween`, `bestStreaks`, so the two always agree), then the items behind it as Upcoming /
 * Done / Missed lists, newest first, and then anything whose words match. Offline; the index is built once per data version
 * (lib/entries.ts), so a query is only a filter.
 */
export interface Hit {
  entry: Entry;
  /** [start, end) ranges of the title that matched a word you typed, for highlighting. */
  marks: Array<[number, number]>;
}

export interface Group {
  id: "upcoming" | "done" | "missed";
  title: string;
  hits: Hit[];
  /** How many more matched than are shown. */
  more: number;
}

export interface Answer {
  /** "Power BI — this week" */
  title: string;
  /** The number the question asked for, big: "14 walks". */
  lead?: string;
  lines: string[];
}

export interface SearchResult {
  query: ParsedQuery;
  answer?: Answer;
  groups: Group[];
  /** "added by app" / "from gmail": what the app did by itself. */
  auto: AutoEntry[];
  empty: boolean;
  total: number;
}

const MAX_SHOWN = 40;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "14 walks", "9 Power BI sessions". */
function noun(areaId: string, name: string, n: number): string {
  if (areaId === "walking") return plural(n, "walk", "walks");
  if (areaId === "meditation") return plural(n, "meditation", "meditations");
  return plural(n, `${name} session`, `${name} sessions`);
}

const slotLabel = (date: ISODate, startMin: number) => `${weekdayShort(date)} ${toHHMM(startMin)}`;

function marksFor(title: string, words: string[]): Array<[number, number]> {
  const lower = title.toLowerCase();
  const out: Array<[number, number]> = [];
  for (const w of words) {
    let i = lower.indexOf(w);
    while (i >= 0) {
      out.push([i, i + w.length]);
      i = lower.indexOf(w, i + w.length);
    }
  }
  // Merge overlaps so the highlight never double-wraps.
  out.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

const sessionMinutes = (data: AppData, areaId: string, from: ISODate, to: ISODate) =>
  (data.sessions ?? []).filter((l) => l.areaId === areaId && l.date >= from && l.date <= to).reduce((n, l) => n + l.minutes, 0);

// ---- The answer card -----------------------------------------------------------------------------------------------------------------------

function answerFor(data: AppData, pq: ParsedQuery, entries: Entry[], today: ISODate, now: Date): Answer | undefined {
  if (!pq.area) return undefined;
  const p = withDefaults(data.profile);
  const id = pq.area.area;
  const a = p.areas.find((x) => x.id === id);
  const name = id === OTHER ? (pq.area.sub && pq.area.sub !== "Other" ? `Other · ${pq.area.sub}` : "Other") : (a?.name ?? id);
  const r = pq.range;
  const lines: string[] = [];
  const lead: Partial<Record<string, string>> = {};
  const title = `${name} — ${r.label}`;
  const monthFrom = toISO(new Date(fromISO(today).getFullYear(), fromISO(today).getMonth(), 1));

  const inRange = (e: Entry) => e.date >= r.from && e.date <= r.to;
  const missed = entries.filter((e) => e.cat.area === id && (!pq.area!.sub || e.cat.sub === pq.area!.sub) && e.status === "missed" && inRange(e)).length;

  if (a?.target) {
    // A tracked area: sessions against the weekly target, exactly as the weekly review counts them.
    const week = weekStart(r.from);
    const isWeek = r.kind === "week" || r.kind === "lastWeek" || (r.kind === "all" && !r.explicit);
    const current = week === weekStart(today);
    const row = weekStats(data, week, today).areas.find((x) => x.id === id);
    const upcoming = current ? planWeek(data, now).sessions.filter((s) => s.areaId === id && !s.done && (s.date > today || s.date === today)).sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start) : [];
    const next = upcoming[0] ? slotLabel(upcoming[0].date, upcoming[0].start) : null;
    if (isWeek && row) {
      const left = Math.max(0, row.target - row.done);
      lines.push(`${r.label === "last week" ? "Last week" : "This week"}: ${row.done} of ${row.target} done${current ? `, ${left} left${next ? ` (next: ${next})` : ""}` : ""}.`);
      lead.week = `${row.done} of ${row.target}`;
      lead.left = `${left} left`;
    }
    if (!isWeek && r.kind !== "month") {
      const n = jarBetween(data, r.from, r.to).sessions[id] ?? 0;
      const min = sessionMinutes(data, id, r.from, r.to);
      lines.push(`${r.label[0].toUpperCase()}${r.label.slice(1)}: ${noun(id, a.name, n)}${min ? ` · ${fmtMinutes(min)}` : ""}.`);
      lead.count = noun(id, a.name, n);
      lead.time = fmtMinutes(min);
    }
    // The month, always (unless it is what was asked).
    if (r.kind !== "month") {
      const n = jarBetween(data, monthFrom, today).sessions[id] ?? 0;
      const min = sessionMinutes(data, id, monthFrom, today);
      lines.push(`This month: ${plural(n, "session", "sessions")} · ${fmtMinutes(min)}.`);
      if (isWeek) {
        lead.count ??= noun(id, a.name, n);
        lead.time ??= fmtMinutes(min);
      }
    } else {
      const n = jarBetween(data, monthFrom, today).sessions[id] ?? 0;
      const min = sessionMinutes(data, id, monthFrom, today);
      lines.unshift(`This month: ${noun(id, a.name, n)} · ${fmtMinutes(min)}.`);
      lead.count = noun(id, a.name, n);
      lead.time = fmtMinutes(min);
    }
    const streak = bestStreaks(data, today).byArea[id] ?? 0;
    if (streak > 0) lines.push(`Best streak: ${plural(streak, "day", "days")}.`);
    lead.streak = `${plural(streak, "day", "days")} in a row at best`;
    lines.push(`Missed: ${missed}.`);
    lead.missed = `${missed} missed`;
    lead.next = next ?? "nothing planned";
  } else if (id === OTHER) {
    // Other: everything that is not a tracked area. Total time and the breakdown, from the same list as the weekly review.
    const list = otherEntriesBetween(data, r.from, r.to).filter((e) => !pq.area!.sub || e.sub === pq.area!.sub);
    const total = list.reduce((n, e) => n + e.minutes, 0);
    const by = new Map<string, number>();
    for (const e of list) by.set(e.sub, (by.get(e.sub) ?? 0) + e.minutes);
    lines.push(`${r.label[0].toUpperCase()}${r.label.slice(1)}: ${fmtMinutes(total)} across ${plural(list.length, "thing", "things")}.`);
    if (!pq.area.sub && by.size) lines.push([...by].sort((x, y) => y[1] - x[1]).map(([s, m]) => `${s} ${fmtMinutes(m)}`).join(" · "));
    if (r.kind === "week" || r.kind === "lastWeek") {
      const w = otherWeek(data, r.from);
      if (w.target) lines.push(`Target: ${fmtMinutes(w.minutes)} of ${fmtMinutes(w.target)}${w.bonus ? ` (+${fmtMinutes(w.bonus)} extra)` : ""}.`);
    }
    lead.count = plural(list.length, "thing", "things");
    lead.time = fmtMinutes(total);
    lead.missed = `${missed} missed`;
  } else {
    // An area without a weekly target (Health, Finance…): what the items say.
    const mine = entries.filter((e) => e.cat.area === id && inRange(e) && e.kind !== "learning" && e.kind !== "note");
    const done = mine.filter((e) => e.status === "done");
    const left = mine.filter((e) => e.status === "upcoming").length;
    const min = done.reduce((n, e) => n + e.minutes, 0);
    lines.push(`${r.label[0].toUpperCase()}${r.label.slice(1)}: ${plural(done.length, "thing", "things")} done${min ? ` · ${fmtMinutes(min)}` : ""}, ${left} left, ${missed} missed.`);
    lead.count = plural(done.length, "thing", "things");
    lead.time = fmtMinutes(min);
    lead.left = `${left} left`;
    lead.missed = `${missed} missed`;
  }

  // The number the question asked for leads.
  // The most specific question wins ("how many pbi missed" asks for the misses, not the count).
  const has = (i: ParsedQuery["intents"][number]) => pq.intents.includes(i);
  const ask = has("missed")
    ? lead.missed
    : has("left")
      ? lead.left
      : has("streak")
        ? lead.streak
        : has("time")
          ? lead.time
          : has("next")
            ? lead.next
            : has("howMany")
              ? (lead.count ?? lead.week)
              : undefined;
  return { title, lead: ask, lines };
}

// ---- The lists -----------------------------------------------------------------------------------------------------------------------------

export function search(data: AppData, text: string, now: Date = new Date()): SearchResult {
  const today = toISO(now);
  const ctx = catCtx(data);
  const pq = parseQuery(text, ctx, today);
  const blank = !text.trim();
  const wantAuto = pq.intents.includes("auto") || pq.intents.includes("gmail");
  const empty: SearchResult = { query: pq, groups: [], auto: [], empty: true, total: 0 };
  if (blank) return empty;

  const entries = buildEntries(data, today);
  const tracked = new Set(withDefaults(data.profile).areas.filter((a) => a.target).map((a) => a.id));
  const hasText = pq.words.length > 0 && !pq.area;
  const r = pq.range;

  // What the app did by itself.
  let auto: AutoEntry[] = [];
  if (wantAuto) {
    const from = pq.range.explicit ? pq.range.from : addDays(today, -30);
    const to = pq.range.explicit ? pq.range.to : today;
    auto = (data.auto ?? [])
      .filter((e) => !e.removed && (pq.intents.includes("gmail") ? e.src.startsWith("gmail") : true))
      .filter((e) => {
        const day = toISO(new Date(e.at));
        return day >= from && day <= to;
      })
      .sort((a, b) => b.at - a.at);
  }

  const matchesArea = (e: Entry) => {
    if (!pq.area) return true;
    if (e.kind === "learning" || e.kind === "note") return false;
    if (pq.area.area === OTHER) return !tracked.has(e.cat.area) && (!pq.area.sub || e.cat.sub === pq.area.sub);
    return e.cat.area === pq.area.area;
  };
  const matchesText = (e: Entry) => {
    if (!hasText) return true;
    const hay = `${e.title} ${e.notes ?? ""}`.toLowerCase();
    return pq.words.every((w) => hay.includes(w));
  };
  // With nothing but words, old history is searched too; an area or an intent defaults to the week.
  const scoped = pq.range.explicit || !hasText;
  const inRange = (e: Entry) => !scoped || (e.date >= r.from && e.date <= r.to);

  let pool: Entry[] = [];
  if (!(wantAuto && !pq.area && !hasText)) {
    pool = entries.filter((e) => matchesArea(e) && matchesText(e) && inRange(e));
    // "next": the future, whatever the range says.
    if (pq.intents.includes("next")) pool = [...pool, ...entries.filter((e) => e.status === "upcoming" && e.date >= today && e.date <= addDays(today, 60) && matchesArea(e) && matchesText(e) && !pool.includes(e))];
  }

  const hit = (entry: Entry): Hit => ({ entry, marks: marksFor(entry.title, pq.words) });
  const make = (id: Group["id"], title: string, list: Entry[], order: (a: Entry, b: Entry) => number): Group => {
    const sorted = [...list].sort(order);
    return { id, title, hits: sorted.slice(0, MAX_SHOWN).map(hit), more: Math.max(0, sorted.length - MAX_SHOWN) };
  };
  const asc = (a: Entry, b: Entry) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "");
  const desc = (a: Entry, b: Entry) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "");
  const only = pq.intents.includes("left") ? "upcoming" : pq.intents.includes("missed") || pq.intents.includes("skipped") ? "missed" : null;
  const missedList = pool.filter((e) => (pq.intents.includes("skipped") && !pq.intents.includes("missed") ? e.status === "skipped" : pq.intents.includes("missed") && !pq.intents.includes("skipped") ? e.status === "missed" : e.status === "missed" || e.status === "skipped"));
  let groups: Group[] = [
    make("upcoming", "Upcoming", pool.filter((e) => e.status === "upcoming"), asc),
    make("done", "Done", pool.filter((e) => e.status === "done"), desc),
    make("missed", "Missed / skipped", missedList, desc),
  ].filter((g) => g.hits.length);
  if (only) groups = groups.filter((g) => g.id === only);

  let answer = answerFor(data, pq, entries, today, now);
  // "what's left this week", "missed this week": no area, so the card is the week as the review sees it.
  if (!answer && !pq.area && !hasText && !wantAuto && (r.kind === "week" || r.kind === "lastWeek")) {
    const w = weekStats(data, r.from, today);
    const left = pool.filter((e) => e.status === "upcoming").length;
    answer = {
      title: `Your ${r.label}`,
      lead: pq.intents.includes("left") ? `${left} left` : pq.intents.includes("missed") ? `${w.missed} missed` : undefined,
      lines: [`${w.percent}% of the week's targets · ${left} left · ${w.missed} missed${w.skipped ? ` · ${w.skipped} skipped` : ""}.`],
    };
  }
  const total = groups.reduce((n, g) => n + g.hits.length + g.more, 0) + auto.length;
  return { query: pq, answer, groups, auto, empty: false, total };
}
