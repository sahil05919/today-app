"use client";
import { Preferences } from "@capacitor/preferences";
import { useSyncExternalStore } from "react";
import { backupKeysFor, emptyData, migrate, needsUpgrade } from "./backup";
import { addDays, toISO, todayISO } from "./dates";
import { logError } from "./debugLog";
import { makeNote, MAX_NOTES } from "./appNotes";
import { record } from "./devTiming";
import { safely } from "./nativeGuard";
import { isNative } from "./platform";
import { seedIfNeeded } from "./seed";
import { addLog, removeLog, wrapKey } from "./sessions";
import { applyDone, completeTaskIn, reopenTaskIn, revertDone, type DoneOptions, type DoneOutcome, type DoneReceipt, type DoneTarget } from "./done";
import { newlyFinished, taskForFreedSlot, withTargetEffects, type FreedChoice } from "./freedom";
import { pendingOn, planSessions } from "./schedule";
import { taskGoal } from "./timer";
import { assignDate, quoteStateOf, takeAnother } from "./quoteBag";
import type { Quote } from "./quotes/types";
import type { ParsedCapture } from "./parse";
import { TEMPLATES } from "./templates";
import {
  addSeries,
  applyOccTask,
  deleteSeriesWhole,
  updateSeriesWhole,
  editSeries,
  endSeries,
  findTask,
  isOccId,
  makeSeries,
  parseOccKey,
  restoreSnapshot,
  setOccSkipped,
  snapshotOf,
  sweepMissed,
  taskToSeries,
  type SeriesPatch,
  type SeriesSnapshot,
} from "./series";
import { billKey } from "./bills";
import { applyMoves } from "./moves";
import { applyClear, clearedEvent, clearedToast } from "./clear";
import type { ClearWindow } from "./clearParse";
import { forget, learnFix, learnItem } from "./learn";
import { taskEvent, withHistory } from "./history";
import { type BlockId } from "./busy";
import { withMark } from "./fixed";
import { BLOCK_LABEL, blockSpan, rippleNote, setBlock as applyBlock, skipBlock as applySkipBlock, tickBlock, type Scope } from "./ripple";
import { catchUpTask, snapshotsDue } from "./weekly";
import { applyReschedule, carryMissed, rescheduleNow, undoReschedule, type Dest, type RescheduleChoice, type RescheduleTarget } from "./reschedule";
import { canTakeOffDay } from "./offday";
import { withLetter } from "./letters";
import { applyPull, lighterLine, type PullCandidate } from "./lighten";
import { ensureLifeSeries } from "./lifeAdmin";
import { addCustomSource, setTick, toggleHidden, toggleWeekly } from "./sideWork";
import type { AppData, AppNote, Bill, BoredIdea, CheckResult, EventMark, CheckInAnswer, CheckInStatus, CoachLetter, DayEntry, FixedEvent, Goal, ISODate, Profile, Recurrence, SessionLog, Settings, Step, Task, TemplateId } from "./types";
import { MAX_FOCUS } from "./types";

/**
 * Where data lives. The rest of the app only talks to the store below, so this can change freely.
 * - Web / PWA: `localStorage` (synchronous).
 * - Android app: Capacitor Preferences (SharedPreferences), which is loaded asynchronously at start-up.
 * - Later: a Supabase-backed adapter.
 */
export interface StorageAdapter {
  load(): AppData | null;
  save(data: AppData): void;
}

export const KEY = "today:v1";
/** A full copy of the data exactly as the older (v1) build saved it, written once before anything is migrated. */
export const BACKUP_KEY = "today:v1:backup-pre-v2";
/** Same again before the v3 (assistant pass) migration. */
export const BACKUP_KEY_V3 = "today:v1:backup-pre-v3";
/** "Do it now": a small first push. */
export const DO_NOW_MIN = 15;

export const localStorageAdapter: StorageAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const upgrade = needsUpgrade(parsed);
      // Schema change: keep the old data first (never overwriting an earlier backup), then migrate and save.
      if (upgrade) for (const k of backupKeysFor(parsed, { v2: BACKUP_KEY, v3: BACKUP_KEY_V3 })) if (localStorage.getItem(k) == null) localStorage.setItem(k, raw);
      const data = migrate(parsed);
      if (upgrade) localStorage.setItem(KEY, JSON.stringify(data));
      return data;
    } catch {
      return null;
    }
  },
  save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save to localStorage", e);
    }
  },
};

/** Reads the saved JSON out of Android's Preferences. Falls back to the WebView's own localStorage once. */
async function loadNative(): Promise<AppData | null> {
  try {
    const got = await safely("Preferences.get", () => Preferences.get({ key: KEY }), null, 10_000);
    const value = got?.value;
    if (value) {
      lastJson = value;
      const parsed = JSON.parse(value);
      const upgrade = needsUpgrade(parsed);
      if (upgrade) {
        // Schema change: the old data is copied to its own key FIRST (an earlier backup is never overwritten).
        for (const k of backupKeysFor(parsed, { v2: BACKUP_KEY, v3: BACKUP_KEY_V3 })) {
          const have = await safely("Preferences.get", () => Preferences.get({ key: k }), { value: null }, 10_000);
          if (!have.value) await safely("Preferences.set", () => Preferences.set({ key: k, value }), undefined, 15_000);
        }
      }
      const data = migrate(parsed);
      if (upgrade) await safely("Preferences.set", () => Preferences.set({ key: KEY, value: JSON.stringify(data) }), undefined, 15_000);
      return data;
    }
  } catch (e) {
    logError("store:load", e);
  }
  // One-time carry-over if this WebView already holds data from an earlier build.
  return localStorageAdapter.load();
}

const native = isNative();

// ---- Saving: debounced, and flushed the moment the app goes to the background ------------------------------------------
//
// The whole data is one JSON text. Writing it on every tap (several hundred KB across the bridge) is what made taps heavy, so a
// change only marks the data dirty and ONE write follows ~300 ms after the last change. Pause / background / page-hide flush at once.

/** Quiet time after the last change before the data is written. */
export const PERSIST_MS = 300;
let dirty = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
/** The text last written to (or read from) Android's storage: lets a resume tell "nothing new" from "changed elsewhere". */
let lastJson: string | null = null;
let writing: Promise<void> = Promise.resolve();
export const persistStats = { writes: 0, lastBytes: 0, lastMs: 0 };

function markDirty() {
  dirty = true;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void flushNow(), PERSIST_MS);
}

/** Writes any unsaved change now. Resolves when it is stored. Safe to call as often as you like. */
export function flushNow(): Promise<void> {
  clearTimeout(persistTimer);
  if (!dirty || !state) return writing;
  dirty = false;
  const snapshot = state;
  const t0 = performance.now();
  if (!native) {
    adapter.save(snapshot);
    persistStats.writes++;
    persistStats.lastMs = performance.now() - t0;
    record("persist (web)", persistStats.lastMs);
    return writing;
  }
  let json: string;
  try {
    json = JSON.stringify(snapshot);
  } catch (e) {
    logError("store:stringify", e);
    return writing;
  }
  lastJson = json;
  persistStats.writes++;
  persistStats.lastBytes = json.length;
  persistStats.lastMs = performance.now() - t0;
  record(`persist stringify (${Math.round(json.length / 1024)} KB)`, persistStats.lastMs);
  writing = writing.then(async () => {
    const ok = await safely("Preferences.set", async () => (await Preferences.set({ key: KEY, value: json }), true), false, 15_000);
    if (!ok) {
      // Not stored: keep it dirty and try again shortly (a hang must never lose a change).
      dirty = true;
      lastJson = null;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => void flushNow(), 5000);
    }
  });
  return writing;
}

let flushHooked = false;
function hookFlush() {
  if (flushHooked || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  flushHooked = true;
  const f = () => void flushNow();
  window.addEventListener("pagehide", f);
  window.addEventListener("beforeunload", f);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && f());
}

/** Anything that must run after a real change (the sync pipeline: notifications, calendar mirror, widget, backup check). */
const changeListeners = new Set<() => void>();
export const onDataChanged = (fn: () => void) => {
  changeListeners.add(fn);
  return () => void changeListeners.delete(fn);
};
/** Goes up by one on every change and every reload: a cheap "has anything changed?" for caches and logs. */
let version = 0;
export const dataVersion = () => version;

/** Called after an event you own is added, edited or deleted: the Android shell uses it to keep the phone calendar in step. */
export type EventChange = "add" | "update" | "remove";
let eventHook: ((kind: EventChange, e: FixedEvent) => void) | null = null;
export const onEventChange = (fn: (kind: EventChange, e: FixedEvent) => void) => {
  eventHook = fn;
};

/** Applies one-off defaults (see lib/seed.ts) to freshly loaded data and saves them if anything changed. */
function prepare(d: AppData): AppData {
  const seeded = seedIfNeeded(d);
  if (seeded !== d) markDirty();
  return seeded;
}
const adapter: StorageAdapter = localStorageAdapter;
let state: AppData | null = null;
let nativeLoading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The current data, or null while the Android app is still reading its storage. */
function peek(): AppData | null {
  if (state) return state;
  if (native) {
    if (!nativeLoading) {
      nativeLoading = true;
      loadNative().then((d) => {
        state = prepare(d ?? emptyData());
        version++;
        hookFlush();
        notify();
      });
    }
    return null;
  }
  state = prepare(adapter.load() ?? emptyData());
  version++;
  hookFlush();
  return state;
}

function ensure(): AppData {
  return peek() ?? emptyData();
}

/** Resolves once the data is available (immediately on the web). For notification handlers on a cold start. */
export function whenLoaded(): Promise<AppData> {
  const now = peek();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const off = subscribe(() => {
      const d = peek();
      if (d) {
        off();
        resolve(d);
      }
    });
  });
}

/** For code outside React (notification handlers). */
export function getData(): AppData {
  return ensure();
}

/** Re-reads storage, e.g. when the Android app comes back to the foreground. */
export async function reloadFromStorage() {
  // Our own unsaved changes are newer than anything in storage: write them first, never read over them.
  await flushNow();
  if (native) {
    const got = await safely("Preferences.get", () => Preferences.get({ key: KEY }), null, 10_000);
    // Nothing else wrote to storage: keep the data we have (no re-render, no side effects re-run for nothing).
    if (!got?.value || got.value === lastJson) return;
  }
  const d = native ? await loadNative() : adapter.load();
  if (d) {
    state = prepare(d);
    version++;
    notify();
    changeListeners.forEach((l) => l());
  }
}

function commit(next: AppData, opts: { history?: boolean; quiet?: boolean } = {}) {
  // Android: never write before the saved data has been read, or we'd overwrite it with an empty list.
  if (native && !state) {
    console.warn("Ignored a change made before storage finished loading");
    return;
  }
  // The history log appends whatever this change did (done, skipped, missed, rescheduled), see lib/history.ts.
  if (state && opts.history !== false) next = withHistory(state, next);
  state = next;
  version++;
  markDirty();
  notify();
  // Bookkeeping (a "last read" time, a log) is saved and shown but does not start the sync again.
  if (!opts.quiet) changeListeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && !native) {
      state = prepare(adapter.load() ?? emptyData());
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** null during SSR, the first hydration pass, and (on Android) while storage loads. */
export function useData(): AppData | null {
  return useSyncExternalStore(subscribe, peek, () => null);
}

const uid = () => crypto.randomUUID();
const mapTask = (id: string, fn: (t: Task) => Task) => {
  const d = ensure();
  // A repeat (seriesId@day) changes THIS occurrence only: the difference goes into its small record.
  if (isOccId(id) && !d.tasks.some((t) => t.id === id)) {
    const t = findTask(d, id);
    if (t) commit(applyOccTask(d, id, t, fn(t)));
    return;
  }
  commit({ ...d, tasks: d.tasks.map((t) => (t.id === id ? fn(t) : t)) });
};
const openFocusCount = (d: AppData) => d.tasks.filter((t) => t.focus && t.status === "open").length;

/** Applies a patch, counting it as a postponement when the date moves later. */
function withPostponeCount(t: Task, patch: Partial<Task>): Task {
  const next = { ...t, ...patch };
  if (!("snoozeCount" in patch) && patch.due && t.due && patch.due > t.due) {
    next.snoozeCount = (t.snoozeCount ?? 0) + 1;
  }
  return next;
}

function applyTemplateTo(task: Task, id: TemplateId): Task {
  const have = new Set(task.steps.map((s) => s.title));
  for (const s of TEMPLATES[id].steps) {
    if (!have.has(s.title)) task.steps.push({ id: uid(), title: s.title, done: false, estimateMin: s.estimateMin });
  }
  task.template = id;
  return task;
}

export const actions = {
  addTask(p: ParsedCapture, fallbackDue?: ISODate): Task {
    const d = ensure();
    const due = p.due ?? fallbackDue;
    const task: Task = {
      id: uid(),
      title: p.title,
      due,
      // A time the app merely suggested ("after work") isn't a commitment: the timeline places the task in the best gap.
      dueTime: p.due && p.timeSource !== "suggested" ? p.dueTime : undefined,
      notes: p.notes,
      recur: p.recur,
      area: p.area,
      important: p.important,
      tags: p.tags,
      estimateMin: p.estimateMin,
      steps: [],
      focus: false,
      status: "open",
      createdAt: Date.now(),
    };
    if (p.template) applyTemplateTo(task, p.template);
    if (p.recur) {
      // A repeat is a series: its occurrences are computed, nothing is generated ahead.
      const series = makeSeries({ title: task.title, notes: task.notes, time: task.dueTime, estimateMin: task.estimateMin, area: task.area, tags: task.tags, important: task.important, steps: task.steps, template: task.template, rule: p.recur, from: due ?? todayISO() });
      const r = addSeries(d, series);
      commit(r.data);
      return r.first;
    }
    commit({ ...d, tasks: [task, ...d.tasks] });
    return task;
  },

  update(id: string, patch: Partial<Task>) {
    mapTask(id, (t) => withPostponeCount(t, patch));
  },

  setDue(id: string, due?: ISODate, dueTime?: string) {
    mapTask(id, (t) => withPostponeCount(t, { due, dueTime: due ? dueTime : undefined }));
  },

  /** Takes back a task that was just added (the Undo on "Added"). A repeat is removed as a whole, not just its first day. */
  undoAdd(id: string) {
    const d = ensure();
    const o = parseOccKey(id);
    if (o && !d.tasks.some((t) => t.id === id) && (d.series ?? []).some((s) => s.id === o.seriesId)) {
      commit({ ...d, series: (d.series ?? []).filter((s) => s.id !== o.seriesId), occurrences: (d.occurrences ?? []).filter((r) => r.seriesId !== o.seriesId) });
      return;
    }
    actions.remove(id);
  },

  /** Puts a deleted task back (for Undo). */
  restore(task: Task) {
    const d = ensure();
    if (isOccId(task.id) && !d.tasks.some((t) => t.id === task.id)) return commit(setOccSkipped(d, task.id, false));
    if (!d.tasks.some((t) => t.id === task.id)) commit({ ...d, tasks: [task, ...d.tasks] });
  },

  /** Starts the focus timer on a task, logging any timer that was already running. */
  startTimer(id: string, goalMin?: number) {
    if (ensure().settings.timer) actions.stopTimer();
    // No goal given: a task with an estimate runs for that long.
    const goal = goalMin ?? taskGoal(findTask(ensure(), id) ?? {});
    actions.settings({ timer: { taskId: id, startedAt: Date.now(), goalMin: goal } });
  },

  /** Parks overdue tasks until a later day: they stay carried over (first in line then) but leave today's plan. */
  parkTasks(ids: string[], until: ISODate) {
    ids.forEach((id) => mapTask(id, (t) => ({ ...t, hideUntil: until })));
  },

  /** Starts a timer on a session / chore / bill (anything on the timeline that isn't a task). */
  startItemTimer(ref: string, label: string, goalMin?: number) {
    if (ensure().settings.timer) actions.stopTimer();
    actions.settings({ timer: { ref, label, startedAt: Date.now(), goalMin } });
  },

  /** Stops the timer and logs the session on the task. Returns what was logged. */
  stopTimer(): { task: Task; minutes: number } | null {
    const d = ensure();
    const timer = d.settings.timer;
    if (!timer) return null;
    if (!timer.taskId) {
      // A session / chore timer has nothing to log on a task: just stop it.
      commit({ ...d, settings: { ...d.settings, timer: undefined } });
      return null;
    }
    const minutes = Math.min(240, Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000)));
    const task = findTask(d, timer.taskId);
    const logged = { at: Date.now(), min: minutes };
    if (task && isOccId(task.id) && !d.tasks.some((t) => t.id === task.id)) {
      const next = applyOccTask(d, task.id, task, { ...task, sessions: [...(task.sessions ?? []), logged] });
      commit({ ...next, settings: { ...next.settings, timer: undefined } });
      return { task, minutes };
    }
    const tasks = d.tasks.map((t) => (t.id === timer.taskId ? { ...t, sessions: [...(t.sessions ?? []), logged] } : t));
    commit({ ...d, tasks, settings: { ...d.settings, timer: undefined } });
    return task ? { task, minutes } : null;
  },

  /** Throws the running timer away without logging it. */
  discardTimer() {
    actions.settings({ timer: undefined });
  },

  /**
   * Completes (or reopens) a task. A repeating task is done for THAT day only (its other days are untouched), so
   * this never returns a "next" copy any more.
   */
  toggleDone(id: string, now: Date = new Date()): Task | null {
    const d = ensure();
    const t = findTask(d, id);
    if (!t) return null;
    if (t.status === "done") {
      const next = reopenTaskIn(d, id);
      if (next) commit(withTargetEffects(d, next, now));
      return null;
    }
    const r = completeTaskIn(d, id, now);
    if (!r) return null;
    commit(withTargetEffects(d, r.data, now));
    return r.next;
  },

  remove(id: string) {
    const d = ensure();
    // A repeat: "delete" means this one day only (use endRepeating for this and every later one).
    if (isOccId(id) && !d.tasks.some((t) => t.id === id)) return commit(setOccSkipped(d, id, true));
    commit({ ...d, tasks: d.tasks.filter((t) => t.id !== id) });
  },

  // --- Repeating tasks (see lib/series.ts) ------------------------------------------------------------
  /** Skips one occurrence (or brings it back). */
  skipOccurrence(id: string, skipped = true) {
    commit(setOccSkipped(ensure(), id, skipped));
  },

  /** Edits a repeat: "this" = this one only, "future" = this and every later one. Returns the id of the occurrence to keep open. */
  editRepeating(id: string, patch: SeriesPatch, scope: "this" | "future"): string {
    const r = editSeries(ensure(), id, patch, scope);
    commit(r.data);
    return r.openId;
  },

  /** A one-off task starts repeating. Returns the occurrence id to keep open. */
  makeRepeating(taskId: string, rule: Recurrence): string | null {
    const r = taskToSeries(ensure(), taskId, rule, todayISO());
    if (!r) return null;
    commit(r.data);
    return r.openId;
  },

  /** Settings → Repeating tasks: change a whole series (title, time, rule). */
  updateSeries(seriesId: string, patch: SeriesPatch) {
    commit(updateSeriesWhole(ensure(), seriesId, patch));
  },

  /** Settings → Repeating tasks: delete a whole series. Returns an Undo. */
  deleteSeries(seriesId: string): () => void {
    const d = ensure();
    const snap = { series: (d.series ?? []).filter((s) => s.id === seriesId), records: (d.occurrences ?? []).filter((r) => r.seriesId === seriesId) };
    commit(deleteSeriesWhole(d, seriesId));
    return () => commit(restoreSnapshot(ensure(), snap));
  },

  /** Side work: tick a source for a week, star it into "Every week", hide it, or add your own. */
  sideWork: {
    tick(week: ISODate, id: string, on: boolean) {
      commit(setTick(ensure(), week, id, on));
    },
    star(id: string) {
      commit(toggleWeekly(ensure(), id));
    },
    hide(id: string) {
      commit(toggleHidden(ensure(), id));
    },
    add(name: string) {
      commit(addCustomSource(ensure(), name));
    },
  },

  /** Settings → Life admin: switching an item on brings it back if it had been deleted. */
  ensureLife(id: string) {
    commit(ensureLifeSeries(ensure(), id, todayISO()));
  },

  /** Switches a series off or on (Life admin). */
  setSeriesOff(seriesId: string, off: boolean) {
    const d = ensure();
    commit({ ...d, series: (d.series ?? []).map((s) => (s.id === seriesId ? { ...s, off: off || undefined } : s)) });
  },

  /** Stops a repeat from this occurrence on (history stays). Returns a snapshot for Undo. */
  endRepeating(id: string): SeriesSnapshot {
    const d = ensure();
    const snap = snapshotOf(d, id);
    commit(endSeries(d, id));
    return snap;
  },

  restoreRepeating(snap: SeriesSnapshot) {
    commit(restoreSnapshot(ensure(), snap));
  },

  /**
   * Housekeeping, cheap to call often: older unresolved repeats become "missed" (only the latest carries forward), and
   * yesterday's missed sessions / bills carry into "Still to do" instead of vanishing.
   */
  sweep(now: Date = new Date()) {
    const d = ensure();
    const next = carryMissed(sweepMissed(d, toISO(now)), now);
    if (next !== d) commit(next);
  },

  // --- The weekly review (see lib/weekly.ts) ----------------------------------------------------------------------
  /** "Add to Sat" / "Add to Sun": one catch-up session, added only because you tapped. Returns an Undo. */
  addCatchUp(c: { areaId: string; date: ISODate; minutes: number }, now: Date = new Date()): (() => void) | null {
    const d = ensure();
    const t = catchUpTask(d, c, now);
    if (!t) return null;
    commit({ ...d, tasks: [t, ...d.tasks] });
    return () => actions.remove(t.id);
  },

  /** "Apply focus": next week's plan gives these areas first pick of the days. */
  applyFocus(week: ISODate, areas: string[]) {
    actions.settings({ focus: areas.length ? { week, areas } : undefined });
  },

  /** The morning self-check: its quiet fixes and its result are saved together. */
  recordCheck(data: AppData, result: CheckResult) {
    commit({ ...data, settings: { ...data.settings, lastCheck: result } }, { quiet: true });
  },

  /**
   * "Lighten my week": moves the picked items to today (a move, not a copy; a session keeps its number and weekly count) and
   * logs each as "pulled forward". Returns the toast text and an Undo.
   */
  pullForward(picks: PullCandidate[], now: Date = new Date()): { message: string; undo: () => void } | null {
    const d = ensure();
    const r = applyPull(d, picks, now);
    if (!r.events.length) return null;
    // The history gets one "pulled" entry per item (not the generic "rescheduled" ones a plain diff would add).
    commit({ ...r.data, history: [...(d.history ?? []), ...r.events] }, { history: false });
    return { message: lighterLine(r.byDay, toISO(now)), undo: () => commit(d, { history: false }) };
  },

  /** Saves the weekly snapshots that are due (finished weeks, Friday's "Week so far", Sunday's "Your week"). */
  saveWeeks(now: Date = new Date()) {
    const d = ensure();
    const due = snapshotsDue(d, now);
    if (!due.length) return;
    const keys = new Set(due.map((w) => `${w.week}|${w.kind}`));
    commit({ ...d, weeks: [...(d.weeks ?? []).filter((w) => !keys.has(`${w.week}|${w.kind}`)), ...due].sort((a, b) => a.week.localeCompare(b.week)).slice(-60) });
  },

  /**
   * Reschedule (it replaces Snooze): +1 hour, this evening, tomorrow morning, a picked date and time, or "Not sure" (the
   * planner decides). Returns the toast text and an Undo, or null when it could not be done (e.g. "this evening" is gone).
   */
  reschedule(target: RescheduleTarget, choice: RescheduleChoice, now: Date = new Date()): { message: string; undo: () => void; dest: Dest } | null {
    const d = ensure();
    const r = rescheduleNow(d, target, choice, now);
    if (!r) return null;
    commit(r.data);
    return { message: r.message, dest: r.dest, undo: () => commit(undoReschedule(ensure(), r.receipt)) };
  },

  /** Moves something to an exact day and time. */
  rescheduleTo(target: RescheduleTarget, dest: Dest, now: Date = new Date()): { message: string; undo: () => void } | null {
    const d = ensure();
    const r = applyReschedule(d, target, dest, now);
    if (!r) return null;
    commit(r.data);
    return { message: r.message, undo: () => commit(undoReschedule(ensure(), r.receipt)) };
  },

  // --- Routine blocks (see lib/ripple.ts) ---------------------------------------------------------------
  /**
   * Changes a routine block (Work, Lunch, Commute, Tea break): "today" for just that day, "every" for the rhythm itself.
   * Returns a one-line note about what moved ("Commute +75 min → moved English Reading to Wed") and an Undo.
   */
  setBlock(id: BlockId, date: ISODate, edit: { start?: number; min?: number }, scope: Scope, now: Date = new Date()): { note: string | null; undo: () => void } {
    const before = ensure();
    const was = blockSpan(before, id, date);
    const after = applyBlock(before, id, date, edit, scope);
    commit(after);
    const now2 = blockSpan(after, id, date);
    const delta = was && now2 ? now2[1] - now2[0] - (was[1] - was[0]) : 0;
    return {
      note: rippleNote(before, after, date, BLOCK_LABEL[id], delta, now),
      undo: () => {
        const c = ensure();
        commit({ ...c, blocks: before.blocks, profile: before.profile });
      },
    };
  },

  /** "Skip today" for a routine block: it is not there that day, and its time is free again. */
  skipBlock(id: BlockId, date: ISODate, now: Date = new Date()): { note: string | null; undo: () => void } {
    const before = ensure();
    const after = applySkipBlock(before, id, date);
    commit(after);
    return { note: rippleNote(before, after, date, BLOCK_LABEL[id] + " skipped", 0, now), undo: () => commit({ ...ensure(), blocks: before.blocks }) };
  },

  /** Brings a skipped routine block back. */
  unskipBlock(id: BlockId, date: ISODate) {
    commit(applySkipBlock(ensure(), id, date, false));
  },

  /** Ticks a routine block off for a day (or takes it back). */
  tickBlock(id: BlockId, date: ISODate, done: boolean) {
    commit(tickBlock(ensure(), id, date, done, Date.now()));
  },

  // --- Events: local marks only (the phone's calendar is never written to) ---------------------------------
  /** Done, hidden for the day, or a local time override on an event. null clears every mark. */
  markEvent(key: string, patch: Partial<EventMark> | null) {
    commit(withMark(ensure(), key, patch));
  },

  /**
   * Skip a task. A repeat's occurrence is marked skipped (it stays in the history); a carried or rescheduled session /
   * chore / bill marks its original skipped; an ordinary task is removed and logged as skipped. Returns an Undo.
   */
  skipTask(id: string, now: Date = new Date()): (() => void) | null {
    const d = ensure();
    const t = findTask(d, id);
    if (!t) return null;
    if (isOccId(id) && !d.tasks.some((x) => x.id === id)) {
      commit(setOccSkipped(d, id, true));
      return () => commit(setOccSkipped(ensure(), id, false));
    }
    const key = t.origin?.key;
    const prevEntry = key ? (d.log ?? []).find((e) => e.key === key) : undefined;
    const log = key ? [...(d.log ?? []).filter((e) => e.key !== key), { key, status: "skip" as const, at: now.getTime() }] : d.log;
    // An ordinary task has no "skipped" state: it leaves the list and the history remembers it was skipped.
    const history = t.origin ? d.history : [...(d.history ?? []), taskEvent(t, "skipped", now.getTime(), t.due ?? toISO(now))];
    commit({ ...d, tasks: d.tasks.filter((x) => x.id !== id), log, history });
    return () => {
      const c = ensure();
      commit({
        ...c,
        tasks: [t, ...c.tasks.filter((x) => x.id !== id)],
        log: key ? [...(c.log ?? []).filter((e) => e.key !== key), ...(prevEntry ? [prevEntry] : [])] : c.log,
        history: t.origin ? c.history : (c.history ?? []).filter((e) => !(e.kind === "skipped" && e.key === taskEvent(t, "skipped", 0, "").key && e.at === now.getTime())),
      });
    };
  },

  /**
   * Moves tasks to other days without counting it as a snooze (the app did it to keep the evening light,
   * or you accepted a catch-up plan).
   */
  moveTasks(moves: Array<{ taskId: string; to: ISODate; time?: string }>) {
    commit(applyMoves(ensure(), moves));
  },

  /** Returns false when the focus list is full. */
  toggleFocus(id: string): boolean {
    const d = ensure();
    const t = findTask(d, id);
    if (!t) return false;
    if (!t.focus && openFocusCount(d) >= MAX_FOCUS) return false;
    mapTask(id, (x) => ({ ...x, focus: !x.focus }));
    return true;
  },

  /** Replace the whole focus list (used by Rescue). */
  setFocusIds(ids: string[]) {
    const d = ensure();
    const keep = new Set(ids.slice(0, MAX_FOCUS));
    commit({ ...d, tasks: d.tasks.map((t) => ({ ...t, focus: t.status === "open" && keep.has(t.id) })) });
  },

  addStep(id: string, title: string, estimateMin?: number, first = false) {
    const step: Step = { id: uid(), title, done: false, estimateMin };
    mapTask(id, (t) => ({ ...t, steps: first ? [step, ...t.steps] : [...t.steps, step] }));
  },

  toggleStep(id: string, stepId: string) {
    mapTask(id, (t) => ({ ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) }));
  },

  removeStep(id: string, stepId: string) {
    mapTask(id, (t) => ({ ...t, steps: t.steps.filter((s) => s.id !== stepId) }));
  },

  applyTemplate(id: string, template: TemplateId) {
    mapTask(id, (t) => applyTemplateTo({ ...t, steps: [...t.steps] }, template));
  },

  recordCheckIn(id: string, status: CheckInStatus) {
    mapTask(id, (t) => ({ ...t, lastCheckIn: { date: todayISO(), status } }));
  },

  /** Saves "Plan my day": each task gets a time slot, and slots left over from an older plan are cleared. */
  applyPlan(date: ISODate, slots: { taskId: string; start: string; min: number }[]) {
    const d = ensure();
    const byId = new Map(slots.map((s) => [s.taskId, s]));
    const tasks = d.tasks.map((t) => {
      const s = byId.get(t.id);
      if (s) return { ...t, slot: { date, start: s.start, min: s.min }, due: t.due ?? date };
      if (t.slot?.date === date) return { ...t, slot: undefined };
      return t;
    });
    commit({ ...d, tasks });
  },

  /**
   * Counts a session: "Power BI session 14". As many as you like per day, each its own numbered session.
   * A date before today is a backdated session. Returns the log that was added (null if the area has no weekly target).
   */
  addSession(areaId: string, date: ISODate = todayISO(), source: SessionLog["source"] = "manual", now: Date = new Date()): SessionLog | null {
    const d = ensure();
    const r = addLog(d, areaId, date, source, now);
    if (!r) return null;
    commit(withTargetEffects(d, r.data, now));
    return r.log;
  },

  /** Takes back ONE session, by its id. Never removes "the one on that day": a second walk leaves the first alone. */
  removeSession(logId: string, now: Date = new Date()) {
    const d = ensure();
    const next = removeLog(d, logId);
    if (next !== d) commit(withTargetEffects(d, next, now));
  },

  /**
   * Ticks anything off: a session, a check-in, a bill, a chore or a task. Every route (the Calendar, Today, typing,
   * the timer) comes through here, so the rules live in one place (see lib/done.ts). The reminders re-plan by themselves.
   */
  markDone(target: DoneTarget, opts: DoneOptions): DoneOutcome & { reached: string[] } {
    const d = ensure();
    const now = opts.now ?? new Date();
    const r = applyDone(d, target, opts);
    if (r.noop) return { ...r, reached: [] };
    commit(withTargetEffects(d, r.data, now));
    return { ...r, reached: newlyFinished(d, r.data, toISO(now)) };
  },

  /** Takes a tick back exactly (the receipt comes from markDone). */
  undoDone(receipt: DoneReceipt, now: Date = new Date()) {
    const d = ensure();
    commit(withTargetEffects(d, revertDone(d, receipt), now));
  },

  /** The freed-time card: fills the slot with a normal task, or leaves it empty (Rest). Either way it is answered. */
  answerFreed(choice: FreedChoice, now: Date = new Date()): Task | null {
    const d = ensure();
    const offer = d.settings.freed;
    if (!offer) return null;
    const task = taskForFreedSlot(d, offer, choice, now);
    commit({ ...d, tasks: task ? [task, ...d.tasks] : d.tasks, settings: { ...d.settings, freed: undefined } });
    return task;
  },

  /** Remembers "this phrase means that item" for next time (see lib/learn.ts). */
  learnDone(title: string, item: string) {
    const d = ensure();
    commit({ ...d, learned: learnItem(d.learned, title, item) });
  },

  /** Marks a check-in done / skipped / snoozed for a day. Pass status null to clear it. */
  setEntry(key: string, status: DayEntry["status"] | null, until?: number) {
    const d = ensure();
    const cutoff = Date.now() - 60 * 86_400_000;
    const rest = (d.log ?? []).filter((e) => e.key !== key && e.at > cutoff);
    commit({ ...d, log: status ? [...rest, { key, status, at: Date.now(), until }] : rest });
  },

  /** "Did you do today's sessions?" → Done: counts everything still planned for that day. */
  markDayDone(date: ISODate = todayISO()) {
    const plan = planSessions(ensure(), new Date());
    for (const s of pendingOn(plan, date)) actions.addSession(s.areaId, date, "checkin");
    actions.setEntry(wrapKey(date), "done");
  },

  // --- Off days (at most 2 a week; see lib/offday.ts) ---------------------------------
  /** Marks a day off. Returns false if it's already off or the week's two are used up. */
  takeOffDay(date: ISODate = todayISO()): boolean {
    const d = ensure();
    if (!canTakeOffDay(d, date)) return false;
    commit({ ...d, offDays: [...(d.offDays ?? []), date].sort().slice(-120) });
    return true;
  },

  cancelOffDay(date: ISODate = todayISO()) {
    const d = ensure();
    commit({ ...d, offDays: (d.offDays ?? []).filter((x) => x !== date) });
  },

  // --- Fixed events ---------------------------------------------------------
  /** Adds a fixed block. Sessions re-plan around it on their own. */
  addEvent(p: ParsedCapture): FixedEvent {
    const d = ensure();
    const event: FixedEvent = {
      id: uid(),
      title: p.title,
      date: p.due ?? todayISO(),
      start: p.event?.start,
      end: p.event?.start ? p.event.end : undefined,
      countsFor: p.event?.countsFor,
      createdAt: Date.now(),
    };
    commit({ ...d, events: [...(d.events ?? []), event] });
    eventHook?.("add", event);
    return event;
  },

  /** Adds an event you have confirmed (from an email, say). Sessions and tasks re-plan around it on their own. */
  addFixedEvent(e: Omit<FixedEvent, "id" | "createdAt">): FixedEvent {
    const d = ensure();
    const event: FixedEvent = { ...e, id: uid(), createdAt: Date.now() };
    commit({ ...d, events: [...(d.events ?? []), event] });
    eventHook?.("add", event);
    return event;
  },

  updateEvent(id: string, patch: Partial<FixedEvent>) {
    const d = ensure();
    commit({ ...d, events: (d.events ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    const e = ensure().events?.find((x) => x.id === id);
    if (e) eventHook?.("update", e);
  },

  /** Keeps the phone's id of an event Today wrote to the calendar (no hook: this is the answer to one). */
  setCalEventId(id: string, calEventId: string) {
    const d = ensure();
    commit({ ...d, events: (d.events ?? []).map((e) => (e.id === id ? { ...e, calEventId } : e)) });
  },

  removeEvent(id: string) {
    const d = ensure();
    const gone = (d.events ?? []).find((e) => e.id === id);
    commit({ ...d, events: (d.events ?? []).filter((e) => e.id !== id) });
    if (gone) eventHook?.("remove", gone);
  },

  /** Replaces the read-only mirror of the phone's calendar. */
  setCalendarEvents(events: FixedEvent[]) {
    const d = ensure();
    commit({ ...d, calendarEvents: events, settings: { ...d.settings, calendarSyncedAt: Date.now() } });
  },

  /** The phone's calendar was read and nothing changed: only the "last read" time moves (no sync, no re-plan). */
  calendarChecked() {
    const d = ensure();
    commit({ ...d, settings: { ...d.settings, calendarSyncedAt: Date.now() } }, { quiet: true });
  },

  /** Adds events from an opened invite (.ics). */
  addImportedEvents(events: Array<Pick<FixedEvent, "title" | "date" | "start" | "end">>): FixedEvent[] {
    const d = ensure();
    const have = new Set((d.events ?? []).map((e) => `${e.title}|${e.date}|${e.start ?? ""}`));
    const added: FixedEvent[] = events
      .filter((e) => !have.has(`${e.title}|${e.date}|${e.start ?? ""}`))
      .map((e) => ({ id: uid(), title: e.title, date: e.date, start: e.start, end: e.start ? e.end : undefined, createdAt: Date.now(), source: "ics" as const }));
    if (added.length) commit({ ...d, events: [...(d.events ?? []), ...added] });
    return added;
  },

  restoreEvent(event: FixedEvent) {
    const d = ensure();
    if (!(d.events ?? []).some((e) => e.id === event.id)) commit({ ...d, events: [...(d.events ?? []), event] });
  },

  // --- Shopping list (you fill it; nothing adds to it for you) -----------------
  addGrocery(names: string[]) {
    const d = ensure();
    const have = new Set((d.grocery ?? []).filter((g) => !g.done).map((g) => g.name.toLowerCase()));
    const fresh = names
      .map((n) => n.trim())
      .filter((n) => n && !have.has(n.toLowerCase()))
      .map((name) => ({ id: uid(), name, done: false, addedAt: Date.now() }));
    if (fresh.length) commit({ ...d, grocery: [...(d.grocery ?? []), ...fresh] });
    return fresh.map((g) => g.id);
  },

  toggleGrocery(id: string) {
    const d = ensure();
    commit({ ...d, grocery: (d.grocery ?? []).map((g) => (g.id === id ? { ...g, done: !g.done } : g)) });
  },

  removeGrocery(id: string) {
    const d = ensure();
    commit({ ...d, grocery: (d.grocery ?? []).filter((g) => g.id !== id) });
  },

  /** Clears everything you've ticked off as bought. */
  clearBought() {
    const d = ensure();
    commit({ ...d, grocery: (d.grocery ?? []).filter((g) => !g.done) });
  },

  // --- Bills and recurring chores ---------------------------------------------
  setBills(bills: Bill[]) {
    const d = ensure();
    commit({ ...d, bills });
  },

  /** Takes back "paid": clears the done mark and restores the previous last-done date. */
  uncompleteBill(id: string, due: ISODate, prevLastDone?: ISODate) {
    const d = ensure();
    commit({
      ...d,
      log: (d.log ?? []).filter((e) => e.key !== billKey(id, due)),
      bills: (d.bills ?? []).map((b) => (b.id === id ? { ...b, lastDone: prevLastDone } : b)),
    });
  },

  // --- Learning from your fixes (offline, on this device) -----------------------------
  /** Remembers "titles like this go to this area / time". Used next time, offline and online. */
  learn(title: string, fix: { areaId?: string; time?: string }) {
    const d = ensure();
    commit({ ...d, learned: learnFix(d.learned, title, fix) });
  },

  /** "Add to my dictionary?": these words now mean this area, offline, from then on. */
  addUserWords(words: string[], areaId: string) {
    const d = ensure();
    const clean = [...new Set(words.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2))];
    const kept = (d.userWords ?? []).filter((u) => !clean.includes(u.word));
    commit({ ...d, userWords: [...kept, ...clean.map((word) => ({ word, areaId, at: Date.now() }))].slice(-1000) });
  },

  removeUserWord(word: string) {
    const d = ensure();
    commit({ ...d, userWords: (d.userWords ?? []).filter((u) => u.word !== word) });
  },

  forgetLearned(id: string) {
    const d = ensure();
    commit({ ...d, learned: forget(d.learned, id) });
  },

  clearLearned() {
    const d = ensure();
    commit({ ...d, learned: [], userWords: [] });
  },

  /** Marks one due date done. "Every N days" chores start counting again from today. */
  completeBill(id: string, due: ISODate, date: ISODate = todayISO()) {
    const d = ensure();
    const cutoff = Date.now() - 60 * 86_400_000;
    const key = billKey(id, due);
    const log = [...(d.log ?? []).filter((e) => e.key !== key && e.at > cutoff), { key, status: "done" as const, at: Date.now() }];
    commit({ ...d, log, bills: (d.bills ?? []).map((b) => (b.id === id ? { ...b, lastDone: date } : b)) });
  },

  // --- Monthly must-haves, and "Getting bored?" ideas ---------------------------
  setGoals(month: string, items: Goal[]) {
    const d = ensure();
    commit({ ...d, goals: { month, items } });
  },

  setIdeas(bored: BoredIdea[]) {
    const d = ensure();
    commit({ ...d, bored });
  },

  setProfile(profile: Profile) {
    const d = ensure();
    commit({ ...d, profile });
  },

  settings(patch: Partial<Settings>) {
    const d = ensure();
    commit({ ...d, settings: { ...d.settings, ...patch } });
  },

  /** Like settings(), for notes the app keeps about its own work (when something was last read): saved, but it does not start a sync. */
  bookkeeping(patch: Partial<Settings>) {
    const d = ensure();
    commit({ ...d, settings: { ...d.settings, ...patch } }, { quiet: true });
  },

  /** History compaction (lib/compact.ts): the old raw entries have been put in a backup file; keep the recent ones and the weekly snapshots. */
  compact(history: AppData["history"], weeks: AppData["weeks"]) {
    const d = ensure();
    commit({ ...d, history, weeks }, { history: false, quiet: true });
  },

  /** Saves today's answer to "How are you feeling?" (one per day, last ~120 kept). */
  answerFeeling(a: Omit<CheckInAnswer, "at">) {
    const d = ensure();
    commit({ ...d, checkins: [...(d.checkins ?? []).filter((c) => c.date !== a.date), { ...a, at: Date.now() }].slice(-120) });
  },

  // --- Quotes (see lib/quoteBag.ts) ---------------------------------------------------
  /** A date's quote is being shown: pin it to its place in the bag so it never changes or repeats. */
  assignQuote(date: ISODate) {
    const d = ensure();
    const next = assignDate(quoteStateOf(d), date);
    if (!d.quotes || next !== d.quotes) commit({ ...d, quotes: next });
  },

  /** "Another one": the next unused quote. */
  anotherQuote(): Quote {
    const d = ensure();
    const { state, quote } = takeAnother(quoteStateOf(d));
    commit({ ...d, quotes: state });
    return quote;
  },

  /** Saves this week's coach letter (one per week, the last 12 kept). */
  saveLetter(letter: CoachLetter) {
    const d = ensure();
    commit({ ...d, letters: withLetter(d.letters, letter) });
  },

  /** Heart on / off. */
  toggleSaveQuote(id: string) {
    const d = ensure();
    const q = quoteStateOf(d);
    commit({ ...d, quotes: { ...q, saved: q.saved.includes(id) ? q.saved.filter((x) => x !== id) : [...q.saved, id] } });
  },

  /**
   * "Clear until 7pm" confirmed: the windows become busy blocks, flexible items re-plan around them, and the fixed ones you chose
   * to move are moved. Returns the toast text and an Undo that restores everything, including the block.
   */
  clearWindows(windows: ClearWindow[], label: string, choose: ReadonlySet<string>, now: Date = new Date()): { message: string; undo: () => void } {
    const d = ensure();
    const group = uid();
    const r = applyClear(d, windows, choose, now, group);
    commit(r.data);
    // A cleared window is its own kind of entry (moved is not skipped, see the weekly review).
    const c = ensure();
    commit({ ...c, history: [...(c.history ?? []), clearedEvent(group, label, windows, now.getTime())] }, { history: false });
    return { message: clearedToast(label, r.moved), undo: () => commit(d, { history: false }) };
  },

  /** Puts a cleared stretch back (every window of that command). */
  removeCleared(group: string) {
    const d = ensure();
    commit({ ...d, cleared: (d.cleared ?? []).filter((c) => c.group !== group) });
  },

  /** "app: …" in Capture: saved to Settings → App notes, never a task. Returns the note (for Undo). */
  addAppNote(text: string, now: Date = new Date()): AppNote {
    const d = ensure();
    const note = makeNote(text, now);
    commit({ ...d, notes: [...(d.notes ?? []), note].slice(-MAX_NOTES) });
    return note;
  },

  removeAppNote(id: string) {
    const d = ensure();
    commit({ ...d, notes: (d.notes ?? []).filter((n) => n.id !== id) });
  },

  replaceAll(data: AppData) {
    commit(data, { history: false });
  },
};
