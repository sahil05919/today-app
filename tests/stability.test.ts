import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store runs in its Android mode here: its data lives in (fake) Capacitor Preferences, and every write is counted.
const prefs = new Map<string, string>();
const io = { sets: 0, gets: 0, hang: false };
vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => (io.gets++, { value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      io.sets++;
      if (io.hang) return new Promise(() => undefined);
      prefs.set(key, value);
    },
  },
}));
// The phone: a notification call that can be made to hang forever.
const notif = { pendingHangs: false, scheduled: 0, cancelled: 0 };
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: "granted" }),
    checkExactNotificationSetting: async () => ({ exact_alarm: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    changeExactNotificationSetting: async () => ({ exact_alarm: "granted" }),
    createChannel: async () => undefined,
    registerActionTypes: async () => undefined,
    getPending: () => (notif.pendingHangs ? new Promise(() => undefined) : Promise.resolve({ notifications: [] })),
    cancel: async () => void notif.cancelled++,
    schedule: async () => void notif.scheduled++,
    addListener: async () => ({ remove: () => undefined }),
  },
}));
vi.mock("../lib/nativeBridge", () => ({
  createAlarmChannel: async () => true,
  saveBackupFile: async (name: string) => ({ name, uri: `content://x/${name}`, size: 1, modified: 1 }),
  pruneBackupFiles: async () => 0,
  armWeeklyBackup: async () => 1,
  backupFileStatus: async () => null,
}));

import { clearErrors, formatErrors, getErrors, logError, MAX_ERRORS, resetErrorLogForTests } from "../lib/debugLog";
import { NativeTimeout, safely, withTimeout } from "../lib/nativeGuard";
import { rescheduleAll } from "../lib/notifications/native";
import { DEBOUNCE_MS, requestSync, resetSyncForTests, setSyncSteps, STEP_BUDGET_MS, syncStats } from "../lib/syncPipeline";
import { seedIfNeeded } from "../lib/seed";
import { actions, flushNow, getData, KEY, PERSIST_MS, persistStats, reloadFromStorage, whenLoaded } from "../lib/store";
import { emptyData } from "../lib/backup";
import type { AppData, Task } from "../lib/types";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  resetErrorLogForTests();
  clearErrors();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the debug log", () => {
  it("keeps the last 50, newest last, and says where each came from", () => {
    for (let i = 0; i < 60; i++) logError(`where${i}`, new Error(`boom ${i}`), 1_000_000 + i * 10_000);
    const list = getErrors();
    expect(list).toHaveLength(MAX_ERRORS);
    expect(list[0].msg).toBe("boom 10");
    expect(list[49]).toMatchObject({ msg: "boom 59", where: "where59" });
  });

  it("the same error in a burst is one line with a count, not a flood", () => {
    for (let i = 0; i < 20; i++) logError("sync", "stuck", 5_000 + i * 10);
    expect(getErrors()).toHaveLength(1);
    expect(getErrors()[0].n).toBe(20);
  });

  it("survives a restart (it is in local storage) and formats for pasting", () => {
    logError("native:queryCalendar", new Error("did not answer in 5 s"), Date.UTC(2026, 9, 12, 8, 0, 0));
    resetErrorLogForTests();
    expect(getErrors()).toHaveLength(1);
    const text = formatErrors(getErrors());
    expect(text).toContain("[native:queryCalendar]");
    expect(text).toContain("did not answer in 5 s");
    expect(text).toContain("2026-10-12T08:00:00.000Z");
  });

  it("never throws, whatever it is given", () => {
    const circular: Record<string, unknown> = {};
    circular.me = circular;
    expect(() => logError("x", circular)).not.toThrow();
    expect(() => logError("x", undefined)).not.toThrow();
  });
});

describe("native calls cannot leave the screen waiting", () => {
  it("a call that never answers is cut off after 5 s, logged, and the fallback is used", async () => {
    vi.useFakeTimers();
    const p = safely("queryCalendar", () => new Promise<string[]>(() => undefined), ["fallback"]);
    await vi.advanceTimersByTimeAsync(5001);
    await expect(p).resolves.toEqual(["fallback"]);
    expect(getErrors()[0]).toMatchObject({ where: "native:queryCalendar" });
    expect(getErrors()[0].msg).toMatch(/did not answer in 5 s/);
  });

  it("a rejection is logged and the fallback used; a good answer passes straight through", async () => {
    await expect(safely("x", () => Promise.reject(new Error("no permission")), 7)).resolves.toBe(7);
    expect(getErrors()[0].msg).toBe("no permission");
    await expect(safely("x", async () => 42, 0)).resolves.toBe(42);
  });

  it("withTimeout rejects with NativeTimeout", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => undefined), "thing", 100);
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(101);
    expect(await caught).toBeInstanceOf(NativeTimeout);
  });

  it("REGRESSION: a hung notification call used to block every later reschedule for good; now the chain recovers", async () => {
    vi.useFakeTimers();
    const data: AppData = { ...seedIfNeeded(emptyData(), new Date(2026, 9, 12, 9, 0)) };
    notif.pendingHangs = true;
    const first = rescheduleAll(data, { force: true });
    await vi.advanceTimersByTimeAsync(6000);
    await first; // it gives up (logged) instead of waiting forever
    expect(getErrors().some((e) => e.where === "notifications:reschedule")).toBe(true);
    notif.pendingHangs = false;
    notif.scheduled = 0;
    const second = rescheduleAll(data, { force: true });
    await vi.advanceTimersByTimeAsync(1000);
    await second;
    expect(notif.scheduled).toBe(1); // …and the next one goes through
  });
});

describe("one sync pipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSyncForTests();
  });

  it("many requests in a burst are ONE run, ~800 ms after the last", async () => {
    let runs = 0;
    setSyncSteps([{ name: "a", run: () => void runs++ }]);
    for (let i = 0; i < 10; i++) {
      requestSync("change");
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(runs).toBe(0); // still being typed into: nothing yet
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(runs).toBe(1);
  });

  it("never runs inside itself: a request during a run becomes exactly one more run, after it", async () => {
    const log: string[] = [];
    let release!: () => void;
    setSyncSteps([
      {
        name: "slow",
        run: () => {
          log.push("start");
          return new Promise<void>((r) => (release = () => (log.push("end"), r())));
        },
      },
    ]);
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    expect(log).toEqual(["start"]);
    // three more changes while it is running
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    expect(log).toEqual(["start"]); // no second run began inside the first
    release();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    expect(log).toEqual(["start", "end", "start"]); // exactly one follow-up
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(log).toEqual(["start", "end", "start", "end"]);
  });

  it("a failing step is logged and the others still run", async () => {
    const ran: string[] = [];
    setSyncSteps([
      { name: "bad", run: () => Promise.reject(new Error("calendar exploded")) },
      { name: "good", run: () => void ran.push("good") },
    ]);
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(ran).toEqual(["good"]);
    expect(getErrors()[0]).toMatchObject({ where: "sync:bad", msg: "calendar exploded" });
  });

  it("a step that hangs is abandoned after its budget and the rest of the run goes on", async () => {
    const ran: string[] = [];
    setSyncSteps([
      { name: "hangs", run: () => new Promise(() => undefined) },
      { name: "after", run: () => void ran.push("after") },
    ]);
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + STEP_BUDGET_MS + 100);
    expect(ran).toEqual(["after"]);
    // …and the pipeline is free again for the next change
    ran.length = 0;
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + STEP_BUDGET_MS + 100);
    expect(ran).toEqual(["after"]);
  });

  it("steps only run for the reasons they ask for", async () => {
    const ran: string[] = [];
    setSyncSteps([
      { name: "always", run: () => void ran.push("always") },
      { name: "openOnly", reasons: ["open"], run: () => void ran.push("openOnly") },
    ]);
    requestSync("change");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    requestSync("open");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(ran).toEqual(["always", "always", "openOnly"]);
  });

  it("FEEDBACK LOOP: a step that changes the data it reacts to is slowed down and logged, not spun", async () => {
    let runs = 0;
    // Every run asks for another run (what a step that writes state which triggers a sync would do).
    setSyncSteps([{ name: "loopy", run: () => (runs++, requestSync("change")) }]);
    requestSync("change");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toBeLessThan(15); // without the breaker: one every 0.8 s = ~75 runs a minute
    expect(getErrors().some((e) => e.where === "sync" && /loop detected/.test(e.msg))).toBe(true);
    expect(syncStats.runs).toBe(runs);
  });
});

const task = (title: string, o: Partial<Task> = {}): Task => ({ id: title, title, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, ...o });

describe("saving is debounced and nothing is lost", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    prefs.clear();
    await whenLoaded();
    actions.replaceAll({ ...seedIfNeeded(emptyData(), new Date(2026, 9, 12, 9, 0)), tasks: [task("a"), task("b")] });
    await flushNow();
  });

  it("twenty-one quick changes are ONE write, 300 ms after the last; the tap itself writes nothing", async () => {
    vi.useFakeTimers();
    const before = persistStats.writes;
    for (let i = 0; i < 21; i++) actions.toggleDone("b"); // an odd number: it ends up done
    expect(persistStats.writes).toBe(before); // the tap path does no writing
    await vi.advanceTimersByTimeAsync(PERSIST_MS - 10);
    expect(persistStats.writes).toBe(before);
    await vi.advanceTimersByTimeAsync(20);
    expect(persistStats.writes).toBe(before + 1);
    expect(JSON.parse(prefs.get(KEY)!).tasks.find((t: Task) => t.id === "b").status).toBe("done");
  });

  it("going to the background flushes at once (nothing waits for the timer)", async () => {
    vi.useFakeTimers();
    actions.addTask({ title: "Call mum", important: false, tags: [] } as never);
    expect(JSON.stringify([...prefs.values()])).not.toContain("Call mum");
    await flushNow();
    expect(prefs.get(KEY)).toContain("Call mum");
  });

  it("a write that hangs does not lose the change: it is retried", async () => {
    vi.useFakeTimers();
    io.hang = true;
    actions.addTask({ title: "Do not lose me", important: false, tags: [] } as never);
    await vi.advanceTimersByTimeAsync(PERSIST_MS + 16_000); // the write times out (logged)
    expect(prefs.get(KEY)).not.toContain("Do not lose me");
    io.hang = false;
    await vi.advanceTimersByTimeAsync(6000); // the retry
    expect(prefs.get(KEY)).toContain("Do not lose me");
  });

  it("coming back to the app does not re-read our own data over unsaved changes, and skips a no-op reload", async () => {
    actions.addTask({ title: "Typed just before I switched apps", important: false, tags: [] } as never);
    const v = getData();
    await reloadFromStorage(); // flushes first, then sees storage == what we hold
    expect(getData()).toBe(v); // the very same data object: nothing re-rendered, no side effects re-run
    expect(getData().tasks.some((t) => t.title === "Typed just before I switched apps")).toBe(true);
  });
});
