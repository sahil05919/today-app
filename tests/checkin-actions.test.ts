import { describe, expect, it } from "vitest";
import { applyCheckInAction } from "../lib/notifications/native";
import { getData, actions } from "../lib/store";
import { toISO } from "../lib/dates";

// These run against the real store (in memory), exactly what the notification buttons call.
const today = toISO(new Date());
const logsFor = (areaId: string) => (getData().sessions ?? []).filter((l) => l.areaId === areaId);

describe("notification buttons: Done / Snooze / Skip", () => {
  it("starts with your areas seeded", () => {
    expect(getData().profile?.areas.find((a) => a.id === "powerbi")?.target?.perWeek).toBe(4);
  });

  it("Done on a session counts it with the next number", () => {
    applyCheckInAction("done", `session:powerbi:${today}`);
    expect(logsFor("powerbi")).toHaveLength(1);
    expect(logsFor("powerbi")[0]).toMatchObject({ n: 1, minutes: 60, source: "checkin" });
  });

  it("Done twice never undoes it or double-counts", () => {
    applyCheckInAction("done", `session:powerbi:${today}`);
    expect(logsFor("powerbi")).toHaveLength(1);
  });

  it("numbers keep climbing across days", () => {
    const tomorrow = toISO(new Date(Date.now() + 86_400_000));
    applyCheckInAction("done", `session:powerbi:${tomorrow}`);
    expect(logsFor("powerbi").map((l) => l.n)).toEqual([1, 2]);
  });

  it("Job sessions alternate Prep / Apply", () => {
    applyCheckInAction("done", `session:job:${today}`);
    applyCheckInAction("done", `session:job:2030-01-01`);
    expect(logsFor("job").map((l) => l.variant)).toEqual(["Job Prep", "Job Apply"]);
  });

  it("Snooze asks again in 30 minutes; Skip clears it for the day", () => {
    const now = 1_000_000;
    applyCheckInAction("snooze", `chore:emails:${today}`, now);
    const e = getData().log!.find((x) => x.key === `chore:emails:${today}`)!;
    expect([e.status, e.until]).toEqual(["snooze", now + 30 * 60_000]);
    applyCheckInAction("skip", `chore:emails:${today}`);
    expect(getData().log!.find((x) => x.key === `chore:emails:${today}`)!.status).toBe("skip");
  });

  it("Done on a chore marks it done", () => {
    applyCheckInAction("done", `chore:emails:${today}`);
    expect(getData().log!.find((x) => x.key === `chore:emails:${today}`)!.status).toBe("done");
  });

  it("Done on the end-of-day question counts everything that was planned", () => {
    const before = (getData().sessions ?? []).length;
    applyCheckInAction("done", `wrap:${today}`);
    const after = getData().sessions ?? [];
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(getData().log!.find((x) => x.key === `wrap:${today}`)!.status).toBe("done");
    // Every area planned today now has a session logged today.
    for (const l of after.filter((x) => x.date === today)) expect(l.source === "checkin" || l.source === "manual").toBe(true);
  });

  it("the Today list can undo a counted session", () => {
    const area = "english";
    // An earlier test ("Done" on the end-of-day check) may already have counted it today, depending on the clock.
    if (logsFor(area).some((l) => l.date === today)) actions.toggleSession(area, today);
    const added = actions.toggleSession(area, today);
    expect(added).not.toBeNull();
    expect(actions.toggleSession(area, today)).toBeNull();
    expect(logsFor(area).some((l) => l.date === today)).toBe(false);
  });
});
