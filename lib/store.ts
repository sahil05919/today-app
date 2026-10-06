"use client";
import { useSyncExternalStore } from "react";
import { emptyData, migrate } from "./backup";
import { todayISO } from "./dates";
import type { ParsedCapture } from "./parse";
import { TEMPLATES } from "./templates";
import type { AppData, CheckInStatus, ISODate, Settings, Step, Task, TemplateId } from "./types";
import { MAX_FOCUS } from "./types";

/** Swap for a Supabase-backed adapter later; the rest of the app only talks to the store. */
export interface StorageAdapter {
  load(): AppData | null;
  save(data: AppData): void;
}

const KEY = "today:v1";

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

const adapter: StorageAdapter = localStorageAdapter;
let state: AppData | null = null;
const listeners = new Set<() => void>();

function ensure(): AppData {
  if (!state) state = adapter.load() ?? emptyData();
  return state;
}

function commit(next: AppData) {
  state = next;
  adapter.save(next);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      state = adapter.load() ?? emptyData();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** null during SSR and the first hydration pass. */
export function useData(): AppData | null {
  return useSyncExternalStore(subscribe, ensure, () => null);
}

const uid = () => crypto.randomUUID();
const mapTask = (id: string, fn: (t: Task) => Task) => {
  const d = ensure();
  commit({ ...d, tasks: d.tasks.map((t) => (t.id === id ? fn(t) : t)) });
};
const openFocusCount = (d: AppData) => d.tasks.filter((t) => t.focus && t.status === "open").length;

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
    mapTask(id, (t) => ({ ...t, ...patch }));
  },

  setDue(id: string, due?: ISODate, dueTime?: string) {
    mapTask(id, (t) => ({ ...t, due, dueTime: due ? dueTime : undefined }));
  },

  toggleDone(id: string) {
    mapTask(id, (t) =>
      t.status === "done"
        ? { ...t, status: "open", completedAt: undefined }
        : { ...t, status: "done", completedAt: Date.now(), focus: false },
    );
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

  settings(patch: Partial<Settings>) {
    const d = ensure();
    commit({ ...d, settings: { ...d.settings, ...patch } });
  },

  replaceAll(data: AppData) {
    commit(data);
  },
};
