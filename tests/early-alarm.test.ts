import { beforeEach, describe, expect, it, vi } from "vitest";

const alarms: Array<{ hour: number; minutes: number; message: string }> = [];
const phone = { ok: true };
vi.mock("../lib/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));
vi.mock("../lib/nativeBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/nativeBridge")>()),
  setPhoneAlarm: async (hour: number, minutes: number, message: string) => {
    if (!phone.ok) return false;
    alarms.push({ hour, minutes, message });
    return true;
  },
}));

import { emptyData } from "../lib/backup";
import { alarmActionFor, alarmKey, alarmMoment, alarmOffer, isEarlyStart } from "../lib/earlyAlarm";
import { setEarlyAlarm } from "../lib/earlyAlarmRun";
import { planNotifications } from "../lib/notifications/plan";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData, whenLoaded } from "../lib/store";
import type { AppData } from "../lib/types";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m); // October 2026

describe("4. one-tap alarms for early starts", () => {
  it("only a start before 08:00 gets the button", () => {
    expect(isEarlyStart(7 * 60)).toBe(true);
    expect(isEarlyStart(7 * 60 + 59)).toBe(true);
    expect(isEarlyStart(8 * 60)).toBe(false);
    expect(alarmOffer("2026-10-15", 9 * 60, at(14, 21))).toEqual({ kind: "none" });
    expect(alarmOffer("2026-10-15", 8 * 60, at(14, 21))).toEqual({ kind: "none" });
    expect(alarmOffer("2026-10-15", 7 * 60, at(14, 21)).kind).toBe("ready");
  });

  it("the alarm rings the wake-up lead before the start: a 07:00 shift at 05:30 (lead 90)", () => {
    expect(alarmMoment("2026-10-15", 7 * 60, 90)).toEqual(at(15, 5, 30));
    const o = alarmOffer("2026-10-15", 7 * 60, at(14, 21));
    expect(o).toMatchObject({ kind: "ready", time: "05:30", hour: 5, minutes: 30 });
    // The lead is a setting.
    expect(alarmOffer("2026-10-15", 7 * 60, at(14, 21), 60)).toMatchObject({ time: "06:00", hour: 6 });
    // A very early start rings the evening before.
    expect(alarmMoment("2026-10-15", 30, 90)).toEqual(at(14, 23, 0));
  });

  it("only within 24 hours of the alarm time: before that it says 'Available the evening before'", () => {
    // Alarm Thu 15 Oct 05:30.
    expect(alarmOffer("2026-10-15", 7 * 60, at(14, 9, 0)).kind).toBe("ready"); // 20.5 h ahead
    expect(alarmOffer("2026-10-15", 7 * 60, at(14, 5, 31)).kind).toBe("ready"); // 23 h 59 min
    expect(alarmOffer("2026-10-15", 7 * 60, at(14, 5, 29))).toMatchObject({ kind: "later", note: "Available the evening before" }); // 24 h 1 min
    expect(alarmOffer("2026-10-15", 7 * 60, at(13, 21))).toMatchObject({ kind: "later", time: "05:30" });
    expect(alarmOffer("2026-10-15", 7 * 60, at(15, 5, 31)).kind).toBe("passed");
    expect(alarmOffer("2026-10-15", 7 * 60, at(15, 6, 0)).kind).toBe("passed");
  });

  it("the night-before notification carries the alarm details", () => {
    const a = alarmActionFor("event:e1", "WTM shift", "2026-10-15", 7 * 60, 90)!;
    expect(a).toEqual({ hour: 5, minutes: 30, message: "WTM shift", key: alarmKey("event:e1", "2026-10-15"), time: "05:30" });
    expect(alarmActionFor("event:e2", "Lunch", "2026-10-15", 12 * 60)).toBeNull();
  });
});

describe("4. the 21:00 reminder", () => {
  const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), at(12, 9)), ...extra });
  const prep1 = (d: AppData, id: string) => planNotifications(d, at(12, 9)).find((n) => n.key === `prep1:${id}`);

  it("an early event's night-before reminder has the Set alarm action; a normal one does not", () => {
    const d = base({
      events: [
        { id: "shift", title: "Pinnacle shift", date: "2026-10-15", start: "07:00", end: "15:00", createdAt: 1, shift: true },
        { id: "gym", title: "Early gym", date: "2026-10-15", start: "06:30", end: "07:30", createdAt: 1 },
        { id: "dinner", title: "Dinner", date: "2026-10-15", start: "19:00", end: "21:00", createdAt: 1 },
      ],
    });
    const n = prep1(d, "shift")!;
    expect(n.at).toEqual(at(14, 21));
    expect(n.setAlarm).toMatchObject({ hour: 5, minutes: 30, time: "05:30" });
    expect(prep1(d, "gym")!.setAlarm).toMatchObject({ hour: 5, minutes: 0 });
    expect(prep1(d, "dinner")).toBeUndefined(); // not a shift, not early: no lead-up
  });

  it("is not offered again once the alarm is set", () => {
    const d = base({ events: [{ id: "shift", title: "Pinnacle shift", date: "2026-10-15", start: "07:00", createdAt: 1, shift: true }] });
    d.settings = { ...d.settings, alarmsSet: { [alarmKey("event:shift", "2026-10-15")]: "05:30" } };
    expect(prep1(d, "shift")!.setAlarm).toBeUndefined();
  });
});

describe("4. setting it", () => {
  beforeEach(async () => {
    alarms.length = 0;
    phone.ok = true;
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    await whenLoaded();
    actions.replaceAll(seedIfNeeded(emptyData(), at(12, 9)));
  });

  it("makes the alarm and marks it, so it shows '⏰ alarm set 05:30' and is not set twice", async () => {
    const a = alarmActionFor("event:shift", "WTM shift", "2026-10-15", 7 * 60)!;
    expect(await setEarlyAlarm(a)).toBe(true);
    expect(alarms).toEqual([{ hour: 5, minutes: 30, message: "WTM shift" }]);
    expect(getData().settings.alarmsSet).toEqual({ [a.key]: "05:30" });
  });

  it("if Android cannot, nothing is marked", async () => {
    phone.ok = false;
    expect(await setEarlyAlarm(alarmActionFor("event:shift", "WTM shift", "2026-10-15", 7 * 60)!)).toBe(false);
    expect(getData().settings.alarmsSet).toBeUndefined();
  });
});
