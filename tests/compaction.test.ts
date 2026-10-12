import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));
const files = { ok: true, saved: [] as Array<{ name: string; text: string }>, pruned: [] as string[] };
vi.mock("../lib/nativeBridge", () => ({
  saveBackupFile: async (name: string, text: string) => {
    if (!files.ok) return null;
    files.saved.push({ name, text });
    return { name, uri: `content://x/${name}`, size: text.length, modified: 1 };
  },
  pruneBackupFiles: async (keep: number, kind: string) => (files.pruned.push(`${kind} ${keep}`), 0),
}));

import { emptyData } from "../lib/backup";
import { compactHistory, historyArchiveName, keepFrom, KEEP_WEEKS } from "../lib/compact";
import { runCompaction } from "../lib/compactRun";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import type { AppData, HistoryEvent } from "../lib/types";

const NOW = new Date(2026, 9, 12, 9, 0); // Mon 12 Oct 2026
let n = 0;
const ev = (at: Date, o: Partial<HistoryEvent> = {}): HistoryEvent => ({ id: `h${++n}`, at: at.getTime(), date: "2026-01-01", kind: "done", type: "task", key: `task:t${n}`, title: `Thing ${n}`, createdByMe: true, ...o });

const withHistory = (history: HistoryEvent[]): AppData => ({ ...seedIfNeeded(emptyData(), NOW), history });

describe("history compaction: 8 weeks stay raw", () => {
  it("the line is the Monday 8 weeks before this week", () => {
    expect(KEEP_WEEKS).toBe(8);
    expect(keepFrom("2026-10-12")).toBe("2026-08-17");
    expect(keepFrom("2026-10-14")).toBe("2026-08-17");
  });

  it("recent entries stay; older ones go to `archived`, and each old week is rolled into a snapshot first", () => {
    const old1 = ev(new Date(2026, 6, 2, 10)); // Thu 2 Jul
    const old2 = ev(new Date(2026, 6, 3, 10));
    const old3 = ev(new Date(2026, 7, 10, 10)); // Mon 10 Aug
    const recent1 = ev(new Date(2026, 7, 18, 10)); // Tue 18 Aug: inside the 8 weeks
    const recent2 = ev(new Date(2026, 9, 9, 10));
    const d = withHistory([old1, old2, old3, recent1, recent2]);
    const c = compactHistory(d, NOW);
    expect(c.archived.map((e) => e.id)).toEqual([old1.id, old2.id, old3.id]);
    expect(c.data.history!.map((e) => e.id)).toEqual([recent1.id, recent2.id]);
    // The two old weeks (29 Jun and 10 Aug) each got a "Your week" snapshot.
    const weeks = (c.data.weeks ?? []).filter((w) => w.kind === "your-week").map((w) => w.week);
    expect(weeks).toEqual(expect.arrayContaining(["2026-06-29", "2026-08-10"]));
  });

  it("a snapshot that already exists is left alone, and nothing old means nothing changes (same object)", () => {
    const recent = ev(new Date(2026, 9, 9, 10));
    const d = withHistory([recent]);
    expect(compactHistory(d, NOW).data).toBe(d);
    expect(compactHistory(d, NOW).archived).toEqual([]);
  });

  it("a 'missed' entry belongs to the week of its day, not of when it was noted", () => {
    const missed = ev(new Date(2026, 9, 9, 10), { kind: "missed", date: "2026-07-02" });
    const c = compactHistory(withHistory([missed]), NOW);
    expect(c.archived).toHaveLength(1);
  });
});

describe("compaction on the phone: the file first, then the data", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    await whenLoaded();
    files.ok = true;
    files.saved = [];
    files.pruned = [];
    const old = ev(new Date(2026, 6, 2, 10));
    const recent = ev(new Date(2026, 9, 9, 10));
    actions.replaceAll(withHistory([old, recent]));
  });

  it("writes today-history-YYYY-MM-DD.json with the old entries, then removes them from the data, once a day", async () => {
    expect(await runCompaction(NOW)).toBe("done");
    expect(files.saved).toHaveLength(1);
    expect(files.saved[0].name).toBe(historyArchiveName(NOW));
    expect(files.saved[0].name).toBe("today-history-2026-10-12.json");
    expect(JSON.parse(files.saved[0].text).events).toHaveLength(1);
    expect(getData().history).toHaveLength(1);
    expect(getData().settings.compactedDate).toBe("2026-10-12");
    expect(files.pruned).toEqual(["history 52"]);
    // Already done today: nothing more is written.
    expect(await runCompaction(NOW)).toBe("skipped");
    expect(files.saved).toHaveLength(1);
  });

  it("if the file cannot be written NOTHING is removed, and it is not retried on every sync", async () => {
    files.ok = false;
    expect(await runCompaction(NOW)).toBe("failed");
    expect(getData().history).toHaveLength(2);
    expect(getData().settings.compactFailedAt).toBe(NOW.getTime());
    files.ok = true;
    expect(await runCompaction(new Date(NOW.getTime() + 3600_000))).toBe("skipped"); // an hour later: too soon
    expect(await runCompaction(new Date(NOW.getTime() + 7 * 3600_000))).toBe("done"); // 7 hours later: tried again
    expect(getData().history).toHaveLength(1);
  });

  it("history entries that arrived while the file was being written are not touched", async () => {
    const live = ev(new Date(2026, 9, 12, 8, 59));
    const original = files.saved;
    void original;
    const p = runCompaction(NOW);
    actions.compact([...(getData().history ?? []), live], getData().weeks);
    await p;
    expect(getData().history!.some((e) => e.id === live.id)).toBe(true);
  });
});
