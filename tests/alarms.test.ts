import { describe, expect, it } from "vitest";
import { dueAlarms, nextAlarmAt, ringTime } from "../lib/alarms";
import { defaultProfile } from "../lib/profile";
import type { AppData, Task } from "../lib/types";

const t = (over: Partial<Task>): Task => ({ id: "a", title: "Take medicine", important: false, tags: [], steps: [], focus: false, status: "open", createdAt: 1, ...over });
const data = (tasks: Task[]): AppData => ({ version: 1, tasks, settings: { firstRunAt: 1 }, profile: defaultProfile() });
const ms = (h: number, m: number, d = 6) => new Date(2026, 9, d, h, m).getTime();

describe("in-app alarms", () => {
  const task = t({ due: "2026-10-06", dueTime: "23:55" });

  it("rings at the time you set, at 11:55 PM", () => {
    expect(dueAlarms(data([task]), ms(23, 54))).toHaveLength(0);
    const [a] = dueAlarms(data([task]), ms(23, 55));
    expect(a.title).toBe("Take medicine");
    expect(nextAlarmAt(data([task]), ms(23, 0))).toBe(ms(23, 55));
  });

  it("keeps ringing until you answer, then stops for good", () => {
    expect(dueAlarms(data([task]), ms(23, 58))).toHaveLength(1);
    expect(dueAlarms(data([{ ...task, alarmAck: ms(23, 56) }]), ms(23, 58))).toHaveLength(0);
    expect(dueAlarms(data([{ ...task, status: "done" }]), ms(23, 58))).toHaveLength(0);
  });

  it("a snooze rings again later, and not before", () => {
    const snoozed = { ...task, alarmAck: ms(23, 56), remindAt: ms(0, 6, 7) };
    expect(ringTime(snoozed)).toBe(ms(0, 6, 7));
    expect(dueAlarms(data([snoozed]), ms(0, 5, 7))).toHaveLength(0);
    expect(dueAlarms(data([snoozed]), ms(0, 6, 7))).toHaveLength(1);
  });

  it("gives up on a reminder that is hours old, and ignores tasks without a time or with reminders off", () => {
    expect(dueAlarms(data([task]), ms(23, 55) + 4 * 3600_000)).toHaveLength(0);
    expect(dueAlarms(data([t({ due: "2026-10-06" })]), ms(23, 58))).toHaveLength(0);
    const off = data([task]);
    off.profile = { ...off.profile!, notify: { ...off.profile!.notify!, reminders: false } } as AppData["profile"];
    expect(dueAlarms(off, ms(23, 58))).toHaveLength(0);
  });
});
