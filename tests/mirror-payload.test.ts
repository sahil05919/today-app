import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- The real nativeBridge, over a fake Capacitor plugin that records exactly what would cross to Java ----
const sent: Array<{ method: string; args: unknown }> = [];
const phone = { calendars: [{ id: 3, name: "Today – Plan", account: "me@gmail.com", accountType: "com.google", primary: false }] as Array<Record<string, unknown>> };
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: unknown) => {
          // What the Capacitor bridge does: the call arguments travel as JSON.
          sent.push({ method, args: args === undefined ? undefined : JSON.parse(JSON.stringify(args)) });
          if (method === "calendarWritePermission") return { state: "granted" };
          if (method === "listCalendars") return { calendars: phone.calendars };
          if (method === "mirrorState") return { calendarId: null, map: {} };
          if (method === "mirrorApply") return { inserted: 1, updated: 0, deleted: 0, failed: 0 };
          if (method === "queryCalendar") return { events: [] };
          if (method === "scheduleDailyMirror") return { at: 1 };
          return {};
        },
      },
    ),
}));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));

import { emptyData } from "../lib/backup";
import { PICK_PLAN } from "../lib/calendarNames";
import { rememberCalendar } from "../lib/calendarPick";
import { clearErrors, getErrors, resetErrorLogForTests } from "../lib/debugLog";
import { sigOf } from "../lib/mirror";
import { mirrorApply, type MirrorEntry, type MirrorOp } from "../lib/nativeBridge";
import { mirrorStep, resetMirrorForTests, runMirror, type MirrorBridge } from "../lib/mirrorRun";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import type { AppData, Task } from "../lib/types";

const NOW = new Date(2026, 9, 13, 8, 0);
const event = { title: "📊 Power BI session 4", start: 1_791_000_000_000, end: 1_791_003_600_000, allDay: false, description: "Duration: 60 min" };
const entry: MirrorEntry = { key: "2026-10-13|session:powerbi", day: "2026-10-13", sig: sigOf(event), event };
const ops: MirrorOp[] = [{ op: "insert", key: entry.key, day: entry.day, sig: entry.sig, event }];
const task = (title: string): Task => ({ id: title, title, important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, due: "2026-10-13", dueTime: "15:00" });
const data = (): AppData => ({ ...seedIfNeeded(emptyData(), NOW), tasks: [task("Fill form")] });

beforeEach(async () => {
  sent.length = 0;
  resetErrorLogForTests();
  clearErrors();
  resetMirrorForTests();
  vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  await whenLoaded();
  actions.replaceAll(data());
});

describe("the payload the Java side reads (mirrorApply)", () => {
  it("calendarId is a NUMBER, ops is an ARRAY of objects, plan is an ARRAY (as the bridge sends them)", async () => {
    // A small id such as 3 is exactly what org.json hands Java as an Integer (the bug: getLong() only accepts a Long).
    await mirrorApply(3, ops, [entry]);
    const call = sent.find((s) => s.method === "mirrorApply")!;
    const a = call.args as { calendarId: unknown; ops: unknown; plan: unknown };
    expect(Object.keys(a).sort()).toEqual(["calendarId", "ops", "plan"]);
    expect(typeof a.calendarId).toBe("number");
    expect(Number.isInteger(a.calendarId)).toBe(true);
    expect(Array.isArray(a.ops)).toBe(true);
    expect(Array.isArray(a.plan)).toBe(true);
    const op = (a.ops as Array<Record<string, unknown>>)[0];
    expect(op).toMatchObject({ op: "insert", key: entry.key, day: "2026-10-13", sig: entry.sig });
    expect(op.event).toEqual(event);
    expect(typeof (op.event as Record<string, unknown>).start).toBe("number");
    expect(typeof (op.event as Record<string, unknown>).allDay).toBe("boolean");
    expect((a.plan as Array<Record<string, unknown>>)[0]).toEqual(entry);
  });

  it("an empty ops array is still sent as an array (the 'nothing to change, just save the plan' call)", async () => {
    await mirrorApply(3, [], [entry]);
    const a = sent.find((s) => s.method === "mirrorApply")!.args as { ops: unknown };
    expect(a.ops).toEqual([]);
  });

  it("is NOT sent at all without a usable calendar id, and says so in Recent errors", async () => {
    for (const bad of [undefined, null, Number.NaN, -1, 1.5, "3"] as unknown as number[]) expect(await mirrorApply(bad, ops, [entry])).toBeNull();
    expect(sent.some((s) => s.method === "mirrorApply")).toBe(false);
    expect(getErrors().some((e) => e.where === "native:mirrorApply")).toBe(true);
  });

  it("the keys the app sends are exactly the keys the Java code reads", () => {
    const plugin = readFileSync("android/app/src/main/java/com/sahil/today/TodayNativePlugin.java", "utf8");
    const store = readFileSync("android/app/src/main/java/com/sahil/today/MirrorStore.java", "utf8");
    // The plugin reads the three arguments by these names, as a number and arrays (never call.getLong, which rejects an Integer).
    expect(plugin).toMatch(/longOf\(call, "calendarId"\)/);
    expect(plugin).toMatch(/arrayOf\(call, "ops"\)/);
    expect(plugin).toMatch(/arrayOf\(call, "plan"\)/);
    expect(plugin).not.toMatch(/call\.getLong\("/);
    // MirrorStore reads every field of an op and of its event by the names the app uses.
    for (const k of ["op", "key", "day", "sig", "final", "event"]) expect(store).toContain(`"${k}"`);
    for (const k of ["title", "start", "end", "allDay", "description"]) expect(store).toContain(`"${k}"`);
    // Android's own side of the contract: a number that fits an Integer must be accepted.
    expect(plugin).toMatch(/instanceof Number\) return \(\(Number\) v\)\.longValue\(\)/);
  });
});

describe("no calendar id, no native call", () => {
  const bridge = (id: unknown): MirrorBridge & { applied: number } => {
    const b = {
      applied: 0,
      access: async () => "granted" as const,
      calendars: async () => [{ id, name: "Today – Plan", account: "me@gmail.com", accountType: "com.google", primary: false }] as never,
      state: async () => ({ calendarId: null, map: {} }),
      apply: async () => (b.applied++, { inserted: 0, updated: 0, deleted: 0, failed: 0 }),
      read: async () => [],
      remove: async () => true,
    };
    return b;
  };

  it("a calendar without a usable id → 'Pick Today – Plan in Settings → Calendar', logged, and apply is never called", async () => {
    for (const id of [undefined, null, "abc", Number.NaN]) {
      const b = bridge(id);
      const r = await runMirror(NOW, b, true, getData());
      expect(r.status).toBe("pick-calendar");
      expect(b.applied).toBe(0);
    }
    expect(getErrors().some((e) => e.where === "mirror" && e.msg.includes(PICK_PLAN))).toBe(true);
  });

  it("a good id (even as a string from an older save) goes through as a number", async () => {
    const b = bridge("3");
    let seen: unknown;
    b.apply = async (id) => ((seen = id), { inserted: 1, updated: 0, deleted: 0, failed: 0 });
    expect((await runMirror(NOW, b, true, getData())).status).toBe("ok");
    expect(seen).toBe(3);
  });
});

describe("the calendar is found on its own, and its id is saved", () => {
  it("the picker value and the auto-find both end up in the profile", async () => {
    expect(getData().profile?.planCalendarId).toBeUndefined();
    const out = await mirrorStep(NOW); // real bridge → fake plugin → "Today – Plan" has id 3
    expect(out.status).toBe("ok");
    expect(getData().profile?.planCalendarId).toBe("3");
    // …and what was sent to Java used that number.
    const a = sent.find((s) => s.method === "mirrorApply")!.args as { calendarId: unknown };
    expect(a.calendarId).toBe(3);
    // Idempotent: nothing is rewritten when the id is already saved.
    const before = getData();
    rememberCalendar("plan", { id: 3 });
    expect(getData()).toBe(before);
    // A new calendar (deleted and made again) replaces the old id.
    rememberCalendar("plan", { id: 7 });
    expect(getData().profile?.planCalendarId).toBe("7");
    rememberCalendar("inbox", { id: 9 });
    expect(getData().profile?.inboxCalendarId).toBe("9");
  });
});
