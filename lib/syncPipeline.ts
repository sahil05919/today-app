import { logError } from "./debugLog";
import { record } from "./devTiming";
import { withTimeout } from "./nativeGuard";

/**
 * THE one place where the app's side effects run: scheduling notifications, the "Today – Plan" calendar mirror, the home-screen
 * widget, the backup check. Nothing else (no component, no action) schedules those directly; they ask here with `requestSync`.
 *
 *  - Debounced: it runs ~800 ms after the LAST request, so a burst of taps is one run.
 *  - One run at a time. A request that arrives during a run is remembered and becomes ONE more run afterwards (coalescing). A run
 *    never starts inside another (no re-entry), so a step that writes data can never cause a stack of overlapping runs.
 *  - Every step has a time budget, and a step that fails or hangs is logged and skipped: the rest still run and the UI carries on.
 *  - A loop breaker: if runs keep starting (a step that always changes the data it reacts to), the next ones are slowed to one
 *    every 20 s and the loop is written to the error log.
 */
export type SyncReason = "change" | "open" | "resume" | "tick" | "daily" | "manual";

export interface SyncStep {
  name: string;
  /** Which reasons run this step. Default: all of them. */
  reasons?: SyncReason[];
  run(ctx: { force: boolean; reasons: ReadonlySet<SyncReason> }): Promise<unknown> | unknown;
}

export const DEBOUNCE_MS = 800;
/** A step that takes longer than this is abandoned for this run (every native call inside also has its own 5 s limit). */
export const STEP_BUDGET_MS = 25_000;
const LOOP_WINDOW_MS = 30_000;
const LOOP_MAX_RUNS = 6;
const LOOP_SLOW_MS = 20_000;

let steps: SyncStep[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;
let pendingForce = false;
const pendingReasons = new Set<SyncReason>();
let starts: number[] = [];
let loopLogged = false;

export const syncStats = { runs: 0, lastMs: 0, lastAt: 0, coalesced: 0 };

/** Replaces the steps (the Android shell installs them once). */
export function setSyncSteps(list: SyncStep[]) {
  steps = list;
}

const loopy = (now: number) => starts.filter((t) => now - t < LOOP_WINDOW_MS).length >= LOOP_MAX_RUNS;

/** Asks for a sync. Cheap to call as often as you like. */
export function requestSync(reason: SyncReason = "change", opts: { force?: boolean; immediate?: boolean } = {}) {
  pendingReasons.add(reason);
  if (opts.force) pendingForce = true;
  clearTimeout(timer);
  const slow = loopy(Date.now());
  if (slow && !loopLogged) {
    loopLogged = true;
    logError("sync", `loop detected: ${starts.length} runs in ${LOOP_WINDOW_MS / 1000} s, slowing down`);
  }
  timer = setTimeout(() => void kick(), slow ? LOOP_SLOW_MS : opts.immediate ? 0 : DEBOUNCE_MS);
}

async function kick() {
  timer = undefined;
  if (running) {
    // No re-entry: this becomes one more run once the current one has finished.
    again = true;
    syncStats.coalesced++;
    return;
  }
  const force = pendingForce;
  const reasons = new Set(pendingReasons);
  pendingForce = false;
  pendingReasons.clear();
  const t0 = Date.now();
  starts = [...starts.filter((t) => t0 - t < LOOP_WINDOW_MS), t0];
  if (!loopy(t0)) loopLogged = false;
  running = (async () => {
    for (const step of steps) {
      if (step.reasons && !step.reasons.some((r) => reasons.has(r))) continue;
      const s0 = performance.now();
      try {
        await withTimeout(Promise.resolve().then(() => step.run({ force, reasons })), `sync:${step.name}`, STEP_BUDGET_MS);
      } catch (e) {
        logError(`sync:${step.name}`, e);
      }
      record(`sync step ${step.name}`, performance.now() - s0);
    }
  })().finally(() => {
    syncStats.runs++;
    syncStats.lastAt = Date.now();
    syncStats.lastMs = syncStats.lastAt - t0;
    record("sync run", syncStats.lastMs);
    running = null;
    if (again) {
      again = false;
      requestSync("change");
    }
  });
}

/** Runs a sync right now and resolves when it (and anything it was already running) has finished. For buttons and tests. */
export async function syncNow(reason: SyncReason = "manual", opts: { force?: boolean } = {}): Promise<void> {
  pendingReasons.add(reason);
  if (opts.force) pendingForce = true;
  clearTimeout(timer);
  while (running) await running;
  await kick();
  while (running) await running;
}

export const syncRunning = () => running !== null;

/** Tests only. */
export function resetSyncForTests() {
  clearTimeout(timer);
  timer = undefined;
  steps = [];
  running = null;
  again = false;
  pendingForce = false;
  pendingReasons.clear();
  starts = [];
  loopLogged = false;
  syncStats.runs = 0;
  syncStats.coalesced = 0;
}
