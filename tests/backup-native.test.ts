import { beforeEach, describe, expect, it, vi } from "vitest";

// The Android bridge is replaced: these tests are about WHAT is asked of the phone, and in which order.
const calls: string[] = [];
const files = { saveOk: true, status: { lastAt: 0, count: 0, nextAt: 0 } as { lastAt: number; count: number; nextAt: number } | null };
// (The store also reads isNative(): it then keeps the data in Capacitor Preferences, which is faked here too.)
vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));
vi.mock("../lib/nativeBridge", () => ({
  saveBackupFile: async (name: string) => {
    calls.push(`save ${name}`);
    return files.saveOk ? { name, uri: `content://x/${name}`, size: 10, modified: 1 } : null;
  },
  pruneBackupFiles: async (keep: number, kind: string) => (calls.push(`prune ${kind} ${keep}`), 0),
  armWeeklyBackup: async () => (calls.push("arm"), 1),
  backupFileStatus: async () => files.status,
  listBackupFiles: async () => [],
  readBackupFile: async () => null,
  shareBackupFile: async () => true,
}));

import { backupNow, ensureWeeklyBackup, restoreFromText } from "../lib/backupFiles";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import type { AppData, Task } from "../lib/types";

const NOW = new Date(2026, 9, 18, 21, 31); // Sunday 18 Oct 2026, just after 21:30
const task = (title: string): Task => ({ id: title, title, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1 });
const withTasks = (...titles: string[]): AppData => ({ ...seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: 1 } }, NOW), tasks: titles.map(task) });

describe("7. backups on the phone", () => {
  const store = new Map<string, string>();
  beforeEach(async () => {
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    await whenLoaded();
    calls.length = 0;
    files.saveOk = true;
    files.status = { lastAt: 0, count: 0, nextAt: 0 };
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    actions.replaceAll(withTasks("Call the bank", "Pay rent"));
  });

  it("Backup now writes today's file, keeps the last 8, and records when", async () => {
    const r = await backupNow(NOW);
    expect(r).toEqual({ ok: true, name: "today-2026-10-18.json" });
    expect(calls).toEqual(["save today-2026-10-18.json", "prune weekly 8"]);
    expect(getData().settings.lastBackupAt).toBe(NOW.getTime());
  });

  it("says so when the file cannot be written, and does not pretend it did", async () => {
    files.saveOk = false;
    const r = await backupNow(NOW);
    expect(r.ok).toBe(false);
    expect(getData().settings.lastBackupAt).toBeUndefined();
    expect(calls).toEqual(["save today-2026-10-18.json"]);
  });

  it("Restore makes a safety copy FIRST, then replaces the data", async () => {
    const incoming = JSON.stringify({ ...withTasks("Old task from the backup"), settings: { firstRunAt: 1 } });
    const r = await restoreFromText(incoming, NOW);
    expect(r).toEqual({ ok: true, tasks: 1, safety: "today-pre-restore-2026-10-18-2131.json" });
    expect(calls).toEqual(["save today-pre-restore-2026-10-18-2131.json", "prune restore 3"]);
    expect(getData().tasks.map((t) => t.title)).toEqual(["Old task from the backup"]);
  });

  it("if the safety copy cannot be written, NOTHING is changed", async () => {
    files.saveOk = false;
    const r = await restoreFromText(JSON.stringify(withTasks("Other")), NOW);
    expect(r).toEqual({ ok: false, error: "Couldn't make a safety copy first, so nothing was changed." });
    expect(getData().tasks.map((t) => t.title)).toEqual(["Call the bank", "Pay rent"]);
  });

  it("a file that is not a Today backup is refused before anything happens", async () => {
    const r = await restoreFromText(JSON.stringify({ hello: "world" }), NOW);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(getData().tasks).toHaveLength(2);
  });

  it("at start the Sunday alarm is armed, and a missed Sunday is taken now", async () => {
    files.status = { lastAt: new Date(2026, 9, 4, 21, 31).getTime(), count: 3, nextAt: 0 }; // the 11 Oct Sunday never ran
    const at = await ensureWeeklyBackup(NOW);
    expect(calls[0]).toBe("arm");
    expect(calls).toContain("save today-2026-10-18.json");
    expect(at).toBe(NOW.getTime());
  });

  it("…but not when this week's backup is there already", async () => {
    files.status = { lastAt: new Date(2026, 9, 18, 21, 30, 5).getTime(), count: 4, nextAt: 0 };
    await ensureWeeklyBackup(NOW);
    expect(calls).toEqual(["arm"]);
  });
});
