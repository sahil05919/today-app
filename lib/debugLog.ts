/**
 * The debug log: the last 50 errors and unhandled rejections (time, message, where), kept in local storage and shown in
 * Settings → Health → Recent errors with a Copy button. It never throws and never blocks: a log that breaks the app would be worse
 * than no log. The same error repeating within a couple of seconds is counted, not stored again.
 */
export interface ErrorEntry {
  /** Epoch ms. */
  at: number;
  msg: string;
  /** Where it came from: "window.onerror", "native:queryCalendar", "sync:notifications"… */
  where: string;
  /** How many times in a row (a log storm is one line). */
  n?: number;
}

export const ERROR_KEY = "today:errors";
export const MAX_ERRORS = 50;
const REPEAT_WINDOW_MS = 2000;

let mem: ErrorEntry[] | null = null;

function read(): ErrorEntry[] {
  if (mem) return mem;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ERROR_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    mem = Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.msg === "string" && Number.isFinite(e.at)).slice(-MAX_ERRORS) : [];
  } catch {
    mem = [];
  }
  return mem;
}

function write(list: ErrorEntry[]) {
  mem = list;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ERROR_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the in-memory copy still serves this session */
  }
}

const messageOf = (err: unknown): string => {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
};

/** Records an error. `where` says which part of the app it came from. */
export function logError(where: string, err: unknown, now: number = Date.now()) {
  try {
    const msg = messageOf(err).slice(0, 300);
    const list = read();
    const last = list[list.length - 1];
    if (last && last.msg === msg && last.where === where && now - last.at < REPEAT_WINDOW_MS) {
      write([...list.slice(0, -1), { ...last, at: now, n: (last.n ?? 1) + 1 }]);
      return;
    }
    write([...list, { at: now, msg, where: where.slice(0, 80) }].slice(-MAX_ERRORS));
    if (typeof console !== "undefined") console.warn(`[today] ${where}: ${msg}`);
  } catch {
    /* never throw from the logger */
  }
}

export function getErrors(): ErrorEntry[] {
  return [...read()];
}

export function clearErrors() {
  write([]);
}

/** The log as plain text, newest first, ready to paste to a developer or an AI. */
export function formatErrors(list: ErrorEntry[] = read(), app = "Today"): string {
  if (!list.length) return `${app}: no errors recorded.`;
  const lines = [...list]
    .reverse()
    .map((e) => `${new Date(e.at).toISOString()}  [${e.where}]  ${e.msg}${e.n && e.n > 1 ? `  (×${e.n})` : ""}`);
  return [`${app}: last ${list.length} error${list.length === 1 ? "" : "s"} (newest first)`, ...lines].join("\n");
}

let installed = false;
/** Catches errors nobody else caught (window errors and unhandled promise rejections). Safe to call twice. */
export function installGlobalErrorHandlers(target: Pick<Window, "addEventListener"> | undefined = typeof window !== "undefined" ? window : undefined) {
  if (installed || !target) return;
  installed = true;
  target.addEventListener("error", (e) => {
    const ev = e as ErrorEvent;
    const at = ev.filename ? ` (${ev.filename.split("/").pop()}:${ev.lineno ?? 0})` : "";
    logError("window.onerror" + at, ev.error ?? ev.message);
  });
  target.addEventListener("unhandledrejection", (e) => {
    logError("unhandledrejection", (e as PromiseRejectionEvent).reason);
  });
}

/** Tests only. */
export function resetErrorLogForTests() {
  mem = null;
  installed = false;
}
