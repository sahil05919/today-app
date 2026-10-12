import { describe, expect, it } from "vitest";
import { planNotifications } from "../lib/notifications/plan";
import { seedIfNeeded } from "../lib/seed";
import { makeSeries } from "../lib/series";
import { cardIssues, checkDue, checkSummary, runSelfCheck } from "../lib/selfcheck";
import type { AppData, Task } from "../lib/types";

const NOW = new Date(2026, 9, 12, 7, 30); // Mon 12 Oct 2026
const DAY = 86_400_000;
const seeded = (over: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded({ version: 3, tasks: [], settings: { firstRunAt: NOW.getTime() - 2 * DAY, lastBackupAt: NOW.getTime() - DAY } }, NOW), ...over });
const vit = (id: string, over = {}) => ({ ...makeSeries({ id, title: "All Vitamin", time: "11:00", rule: { freq: "daily", interval: 1 }, from: "2026-10-12", createdAt: id === "a" ? 1 : 2 }), ...over });
const task = (o: Partial<Task>): Task => ({ id: `t${Math.random()}`, title: "Task", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: NOW.getTime(), ...o });

describe("2. the morning self-check", () => {
  it("is due on the first open of a day, and again after 12 hours, but not in between", () => {
    const d = seeded();
    expect(checkDue(d, NOW)).toBe(true);
    const out = runSelfCheck(d, NOW).result;
    const checked = { ...d, settings: { ...d.settings, lastCheck: out } };
    expect(checkDue(checked, new Date(2026, 9, 12, 9, 0))).toBe(false);
    expect(checkDue(checked, new Date(2026, 9, 12, 20, 0))).toBe(true);
    expect(checkDue(checked, new Date(2026, 9, 13, 7, 0))).toBe(true);
  });

  it("a normal week comes back clean", () => {
    const r = runSelfCheck(seeded({ series: [vit("a")] }), NOW);
    expect(r.result.issues).toEqual([]);
    expect(r.result.fixed).toEqual([]);
    expect(checkSummary(r.result)).toBe("All good");
  });

  it("merges a duplicate series, removes a typed command, and says so", () => {
    const d = seeded({ series: [vit("a"), vit("b", { time: undefined })], tasks: [task({ title: "work done" }), task({ title: "Call the bank" })] });
    const r = runSelfCheck(d, NOW);
    expect(r.data.series).toHaveLength(1);
    expect(r.data.tasks.map((t) => t.title)).toEqual(["Call the bank"]);
    expect(r.result.fixed.join(" | ")).toMatch(/duplicate/);
    expect(r.result.fixed.join(" | ")).toMatch(/command/);
    // Running it again finds nothing more to fix.
    expect(runSelfCheck(r.data, NOW).result.fixed).toEqual([]);
  });

  it("flags a weekly target that cannot be fully placed", () => {
    const late = new Date(2026, 9, 16, 20, 0);
    const r = runSelfCheck(seeded(), late).result;
    expect(r.issues.some((i) => i.kind === "target" && /fit this week\. Tap to choose$/.test(i.text) && i.action === "targets")).toBe(true);
    // The home card does not repeat what the shortfall card already says.
    expect(cardIssues(r, "2026-10-16").some((i) => i.kind === "target")).toBe(false);
  });

  it("notifications: schedules what is missing and cancels what no longer applies", () => {
    const d = seeded({ series: [vit("a")] });
    const plan = planNotifications(d, NOW);
    const ok = runSelfCheck(d, NOW, { pendingIds: plan.map((n) => n.id) });
    expect(ok.reschedule).toBe(false);
    const broken = runSelfCheck(d, NOW, { pendingIds: [...plan.slice(1).map((n) => n.id), 123456789] });
    expect(broken.reschedule).toBe(true);
    expect(broken.result.fixed.join(" ")).toMatch(/Scheduled 1 missing reminder.*cancelled 1/);
    // Off in Android: nothing can be fixed, so it is said.
    expect(runSelfCheck(d, NOW, { notificationsOff: true }).result.issues[0]).toMatchObject({ kind: "notification" });
    // Web (no native list): the check is skipped, not failed.
    expect(runSelfCheck(d, NOW).reschedule).toBe(false);
  });

  it("an item waiting for room for more than 7 days is offered for Lighten my week", () => {
    const old = NOW.getTime() - 10 * DAY;
    const crowded = Array.from({ length: 14 }, (_, i) => task({ title: `Big ${i}`, due: "2026-10-12", estimateMin: 90, createdAt: old }));
    const r = runSelfCheck(seeded({ tasks: crowded }), NOW).result;
    const o = r.issues.find((i) => i.kind === "orphan");
    expect(o).toBeTruthy();
    expect(o!.action).toBe("lighten");
    // Fresh ones are not orphans yet.
    const fresh = crowded.map((t) => ({ ...t, createdAt: NOW.getTime() }));
    expect(runSelfCheck(seeded({ tasks: fresh }), NOW).result.issues.some((i) => i.kind === "orphan")).toBe(false);
  });

  it("flags a backup older than 8 days", () => {
    const stale = seeded({ tasks: [task({})], settings: { firstRunAt: NOW.getTime() - 30 * DAY, lastBackupAt: NOW.getTime() - 9 * DAY } });
    expect(runSelfCheck(stale, NOW).result.issues.find((i) => i.kind === "backup")).toMatchObject({ action: "backup", text: "No backup for 9 days." });
    expect(runSelfCheck(stale, NOW, { lastBackupAt: NOW.getTime() - 2 * DAY }).result.issues.some((i) => i.kind === "backup")).toBe(false);
    const fresh = { ...stale, settings: { ...stale.settings, lastBackupAt: NOW.getTime() - 7 * DAY } };
    expect(runSelfCheck(fresh, NOW).result.issues.some((i) => i.kind === "backup")).toBe(false);
  });
});
