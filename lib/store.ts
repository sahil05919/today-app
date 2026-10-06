"use client";
import { Preferences } from "@capacitor/preferences";
import { useSyncExternalStore } from "react";
import { emptyData, migrate } from "./backup";
import { todayISO } from "./dates";
import { isNative } from "./platform";
import { nextOccurrence } from "./recur";
import { seedIfNeeded } from "./seed";
import { nextNumber, variantFor, wrapKey } from "./sessions";
import { pendingOn, planSessions } from "./schedule";
import type { ParsedCapture } from "./parse";
import { TEMPLATES } from "./templates";
import { billKey } from "./bills";
import type { AppData, Bill, BoredIdea, CheckInStatus, DayEntry, FixedEvent, Goal, ISODate, Profile, SessionLog, Settings, Step, Task, TemplateId } from "./types";
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

export const localStorageAdapter: StorageAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : null;
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
    const { value } = await Preferences.get({ key: KEY });
    if (value) return migrate(JSON.parse(value));
  } catch (e) {
    console.warn("Could not read Preferences", e);
  }
  // One-time carry-over if this WebView already holds data from an earlier build.
  return localStorageAdapter.load();
}

function saveNative(data: AppData) {
  Preferences.set({ key: KEY, value: JSON.stringify(data) }).catch((e) => console.warn("Could not save", e));
}

const native = isNative();

/** Applies one-off defaults (see lib/seed.ts) to freshly loaded data and saves them if anything changed. */
function prepare(d: AppData): AppData {
  const seeded = seedIfNeeded(d);
  if (seeded !== d) {
    if (native) saveNative(seeded);
    else adapter.save(seeded);
  }
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
        notify();
      });
    }
    return null;
  }
  state = prepare(adapter.load() ?? emptyData());
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
  const d = native ? await loadNative() : adapter.load();
  if (d) {
    state = prepare(d);
    notify();
  }
}

function commit(next: AppData) {
  // Android: never write before the saved data has been read, or we'd overwrite it with an empty list.
  if (native && !state) {
    console.warn("Ignored a change made before storage finished loading");
    return;
  }
  state = next;
  if (native) saveNative(next);
  else adapter.save(next);
  notify();
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
      dueTime: p.due ? p.dueTime : undefined,
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
    // Due today and there's room: straight into focus.
    if (due === todayISO() && openFocusCount(d) < MAX_FOCUS) task.focus = true;
    commit({ ...d, tasks: [task, ...d.tasks] });
    return task;
  },

  update(id: string, patch: Partial<Task>) {
    mapTask(id, (t) => withPostponeCount(t, patch));
  },

  setDue(id: string, due?: ISODate, dueTime?: string) {
    mapTask(id, (t) => withPostponeCount(t, { due, dueTime: due ? dueTime : undefined }));
  },

  /** Puts a deleted task back (for Undo). */
  restore(task: Task) {
    const d = ensure();
    if (!d.tasks.some((t) => t.id === task.id)) commit({ ...d, tasks: [task, ...d.tasks] });
  },

  /** Starts the focus timer on a task, logging any timer that was already running. */
  startTimer(id: string) {
    if (ensure().settings.timer) actions.stopTimer();
    actions.settings({ timer: { taskId: id, startedAt: Date.now() } });
  },

  /** Stops the timer and logs the session on the task. Returns what was logged. */
  stopTimer(): { task: Task; minutes: number } | null {
    const d = ensure();
    const timer = d.settings.timer;
    if (!timer) return null;
    const minutes = Math.min(240, Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000)));
    const task = d.tasks.find((t) => t.id === timer.taskId);
    const tasks = d.tasks.map((t) =>
      t.id === timer.taskId ? { ...t, sessions: [...(t.sessions ?? []), { at: Date.now(), min: minutes }] } : t,
    );
    commit({ ...d, tasks, settings: { ...d.settings, timer: undefined } });
    return task ? { task, minutes } : null;
  },

  /** Throws the running timer away without logging it. */
  discardTimer() {
    actions.settings({ timer: undefined });
  },

  /**
   * Completes (or reopens) a task. Completing a recurring task spawns its next occurrence and returns it;
   * reopening removes that spawned occurrence again so nothing is duplicated.
   */
  toggleDone(id: string): Task | null {
    const d = ensure();
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return null;

    if (t.status === "done") {
      const tasks = d.tasks
        .filter((x) => !(t.nextId && x.id === t.nextId && x.status === "open"))
        .map((x) => (x.id === id ? { ...x, status: "open" as const, completedAt: undefined, nextId: undefined } : x));
      commit({ ...d, tasks });
      return null;
    }

    const today = todayISO();
    let next: Task | null = null;
    if (t.recur) {
      // If it's overdue, count from today so we don't spawn a pile of missed occurrences.
      const base = t.due && t.due > today ? t.due : today;
      next = {
        ...t,
        id: uid(),
        due: nextOccurrence(t.recur, base),
        steps: t.steps.map((s) => ({ ...s, id: uid(), done: false })),
        status: "open",
        completedAt: undefined,
        nextId: undefined,
        focus: false,
        lastCheckIn: undefined,
        createdAt: Date.now(),
      };
    }
    const done: Task = { ...t, status: "done", completedAt: Date.now(), focus: false, nextId: next?.id };
    commit({ ...d, tasks: [...(next ? [next] : []), ...d.tasks.map((x) => (x.id === id ? done : x))] });
    return next;
  },

  remove(id: string) {
    const d = ensure();
    commit({ ...d, tasks: d.tasks.filter((t) => t.id !== id) });
  },

  /** Returns false when the focus list is full. */
  toggleFocus(id: string): boolean {
    const d = ensure();
    const t = d.tasks.find((x) => x.id === id);
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
   * Counts a session: "Power BI session 14". One per area per day; calling it again for the same day undoes it.
   * Returns the log that was added, or null if it was removed.
   */
  toggleSession(areaId: string, date: ISODate = todayISO(), source: SessionLog["source"] = "manual"): SessionLog | null {
    const d = ensure();
    const existing = (d.sessions ?? []).find((l) => l.areaId === areaId && l.date === date);
    if (existing) {
      commit({ ...d, sessions: (d.sessions ?? []).filter((l) => l.id !== existing.id) });
      return null;
    }
    const area = d.profile?.areas.find((a) => a.id === areaId);
    if (!area?.target) return null;
    const n = nextNumber(d.sessions, areaId);
    const log: SessionLog = {
      id: uid(),
      areaId,
      date,
      minutes: area.target.minutes,
      n,
      variant: variantFor(area, n),
      at: Date.now(),
      source,
    };
    // Counting a session also clears any "skipped" mark for it.
    commit({ ...d, sessions: [...(d.sessions ?? []), log], log: (d.log ?? []).filter((e) => e.key !== `session:${areaId}:${date}`) });
    return log;
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
    for (const s of pendingOn(plan, date)) actions.toggleSession(s.areaId, date, "checkin");
    actions.setEntry(wrapKey(date), "done");
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
    return event;
  },

  updateEvent(id: string, patch: Partial<FixedEvent>) {
    const d = ensure();
    commit({ ...d, events: (d.events ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  },

  removeEvent(id: string) {
    const d = ensure();
    commit({ ...d, events: (d.events ?? []).filter((e) => e.id !== id) });
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
    return fresh.length;
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

  replaceAll(data: AppData) {
    commit(data);
  },
};
