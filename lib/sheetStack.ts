/**
 * ONE manager for every sheet and modal. A sheet registers when it opens and unregisters when it closes, in the order it was opened:
 *
 *  - stack order decides the z-index (never hard-coded), so a sheet opened from another sheet is always on top;
 *  - only the TOP sheet draws a backdrop, and a sheet that is not on top does not;
 *  - Escape and the Android Back button close only the top sheet; a notification tap closes them all, then opens its target;
 *  - the body's scroll lock follows the stack: locked while any sheet is open, released the moment the stack is empty (the old
 *    code saved and restored the previous value, which leaked "locked" when two sheets closed in the wrong order).
 *
 * Plain module state with a tiny subscribe API, so React reads it with useSyncExternalStore and the tests need no DOM.
 */
export interface StackEntry {
  /** Opening order: bigger = opened later = higher. */
  id: number;
  close: () => void;
  /** The sheet's root element, used only to notice an entry whose element is gone. */
  el?: { isConnected: boolean } | null;
}

let seq = 0;
let entries: StackEntry[] = [];
let version = 0;
const listeners = new Set<() => void>();
let locked = false;
let keyHooked = false;

/** Hands out the next opening-order number. Called while a sheet renders for the first time. */
export const nextSheetId = () => ++seq;

function applyLock() {
  const want = entries.length > 0;
  if (want === locked) return;
  locked = want;
  try {
    if (typeof document !== "undefined" && document.body) document.body.style.overflow = want ? "hidden" : "";
  } catch {
    /* no DOM */
  }
}

function changed() {
  version++;
  applyLock();
  listeners.forEach((l) => l());
}

function hookKeys() {
  if (keyHooked || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  keyHooked = true;
  window.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && closeTopSheet()) e.preventDefault?.();
  });
  // Coming back to the app (or the tab): drop any entry whose element has gone, and release a lock nothing holds.
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reconcileStack());
}

/** Registers a sheet (or replaces its entry if the id is already there). */
export function registerSheet(entry: StackEntry) {
  hookKeys();
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) entries[i] = entry;
  else entries = [...entries, entry].sort((a, b) => a.id - b.id);
  changed();
}

export function unregisterSheet(id: number) {
  if (!entries.some((e) => e.id === id)) return;
  entries = entries.filter((e) => e.id !== id);
  changed();
}

/** Keeps the entry's close handler current without re-registering (the handler is usually a fresh arrow each render). */
export function updateSheetClose(id: number, close: () => void) {
  const e = entries.find((x) => x.id === id);
  if (e) e.close = close;
}

/** 0 = the bottom sheet; -1 = not registered (yet). */
export const sheetDepth = (id: number) => entries.findIndex((e) => e.id === id);
export const sheetCount = () => entries.length;
export const isTopSheet = (id: number) => entries.length > 0 && entries[entries.length - 1].id === id;
export const sheetStackVersion = () => version;
export const bodyScrollLocked = () => locked;

export function subscribeSheetStack(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The z-index of a sheet: 40 for the bottom one, one more for each above it (the fixed overlays at 80+ stay above all sheets). */
export const sheetZ = (id: number) => 40 + Math.max(0, sheetDepth(id) < 0 ? entries.length : sheetDepth(id));

const safeClose = (e: StackEntry) => {
  try {
    e.close();
  } catch (err) {
    // A close handler that throws must not trap the user in the sheet.
    console.warn("[today] a sheet's close handler failed", err);
    unregisterSheet(e.id);
  }
};

/** Back button / Escape: closes only the top sheet. Returns false when there was none (Back then minimises the app). */
export function closeTopSheet(): boolean {
  reconcileStack();
  const top = entries[entries.length - 1];
  if (!top) return false;
  safeClose(top);
  return true;
}

/** A notification tap: closes every sheet, top first, so the target opens on a clean screen. Returns how many were open. */
export function closeAllSheets(): number {
  reconcileStack();
  const open = [...entries].reverse();
  open.forEach(safeClose);
  return open.length;
}

/** Forgets entries whose element is gone and releases the scroll lock if nothing holds it. Cheap; safe to call any time. */
export function reconcileStack() {
  const alive = entries.filter((e) => !e.el || e.el.isConnected);
  if (alive.length !== entries.length) {
    entries = alive;
    changed();
  } else if (locked !== entries.length > 0) {
    applyLock();
  }
  // The lock itself could have been left behind by something else: with an empty stack the body must be free.
  if (!entries.length) {
    try {
      if (typeof document !== "undefined" && document.body && document.body.style.overflow === "hidden") document.body.style.overflow = "";
    } catch {
      /* no DOM */
    }
  }
}

/** Tests only. */
export function resetSheetStackForTests() {
  entries = [];
  seq = 0;
  version = 0;
  locked = false;
  listeners.clear();
}
