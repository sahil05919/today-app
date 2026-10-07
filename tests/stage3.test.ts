import { describe, expect, it } from "vitest";
import { cheerLine, eveningLine, greetingFor } from "../lib/cheer";
import { paceStatus } from "../lib/pace";
import { planSessions } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { nextNumber } from "../lib/sessions";
import { migrate } from "../lib/backup";
import type { AppData, SessionLog } from "../lib/types";

const MON = new Date(2026, 9, 5, 7, 0);
const base = (): AppData => seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }, MON);
const log = (areaId: string, date: string, n: number): SessionLog => ({ id: `${areaId}${n}`, areaId, date, minutes: 60, n, at: 1, source: "manual" });

describe("session numbers continue from your old history", () => {
  it("starts at the number you set", () => {
    expect(nextNumber([], "powerbi")).toBe(1);
    expect(nextNumber([], "powerbi", 14)).toBe(14);
  });

  it("keeps counting from your own logs once you're past it", () => {
    expect(nextNumber([log("powerbi", "2026-10-05", 14)], "powerbi", 14)).toBe(15);
    expect(nextNumber([log("powerbi", "2026-10-05", 3)], "powerbi", 14)).toBe(14);
  });

  it("the plan titles use it: 'Power BI session 14'", () => {
    const d = base();
    const areas = d.profile!.areas.map((a) => (a.id === "powerbi" ? { ...a, target: { ...a.target!, startAt: 14 } } : a));
    const plan = planSessions({ ...d, profile: { ...d.profile!, areas } }, MON).filter((s) => s.areaId === "powerbi");
    expect(plan.map((s) => s.n)).toEqual([14, 15, 16, 17].slice(0, plan.length));
    expect(plan[0].title).toBe("Power BI session 14");
  });

  it("survives a backup round trip", () => {
    const d = base();
    const areas = d.profile!.areas.map((a) => (a.id === "powerbi" ? { ...a, target: { ...a.target!, startAt: 14 } } : a));
    const back = migrate(JSON.parse(JSON.stringify({ ...d, profile: { ...d.profile!, areas } })));
    expect(back.profile!.areas.find((a) => a.id === "powerbi")!.target!.startAt).toBe(14);
  });

  it("new settings survive a save and load", () => {
    const d = base();
    const back = migrate(JSON.parse(JSON.stringify({ ...d, profile: { ...d.profile!, hideMic: true, sleepStart: "23:30", eveningCapMin: 120, officeCommuteMin: 50 } })));
    expect(back.profile).toMatchObject({ hideMic: true, sleepStart: "23:30", eveningCapMin: 120, officeCommuteMin: 50 });
    const withWords = migrate(JSON.parse(JSON.stringify({ ...d, userWords: [{ word: "Frob", areaId: "work", at: 1 }], settings: { ...d.settings, snoozes: { "task:1@2026-10-06": 2 } } })));
    expect(withWords.userWords).toEqual([{ word: "frob", areaId: "work", at: 1 }]);
    expect(withWords.settings.snoozes).toEqual({ "task:1@2026-10-06": 2 });
  });
});

describe("progress on pace", () => {
  it("is on track at the start of the week, whatever the raw total", () => {
    expect(paceStatus(base(), "2026-10-05").status).toBe("on-track");
  });

  it("is slightly behind by Thursday with nothing done", () => {
    const p = paceStatus(base(), "2026-10-08");
    expect(p.status).toBe("behind");
    expect(p.label).toBe("Slightly behind");
  });

  it("is on track mid-week when you've done what's expected by then, even if the week total is low", () => {
    const d = base();
    const logs = [
      log("powerbi", "2026-10-05", 1), log("powerbi", "2026-10-06", 2),
      log("meditation", "2026-10-05", 1),
      log("job", "2026-10-05", 1), log("job", "2026-10-06", 2),
      log("english", "2026-10-05", 1), log("english", "2026-10-06", 2),
      log("walking", "2026-10-05", 1), log("walking", "2026-10-06", 2),
    ];
    expect(paceStatus({ ...d, sessions: logs }, "2026-10-07").status).toBe("on-track");
  });
});

describe("feels good to open", () => {
  it("greets you by name through the day", () => {
    expect(greetingFor("Sahil", new Date(2026, 9, 6, 8))).toBe("Good morning, Sahil");
    expect(greetingFor("Sahil", new Date(2026, 9, 6, 14))).toBe("Good afternoon, Sahil");
    expect(greetingFor("Sahil", new Date(2026, 9, 6, 19))).toBe("Good evening, Sahil");
    expect(greetingFor("", new Date(2026, 9, 6, 8))).toBe("Good morning");
  });

  it("says how the day went, kindly", () => {
    expect(eveningLine("Sahil", 5, 6)).toBe("Today: 5 of 6 done. Nice work, Sahil.");
    expect(eveningLine("Sahil", 6, 6)).toContain("Well done");
    expect(eveningLine("Sahil", 0, 4)).not.toMatch(/fail|miss|behind|should|lazy/i);
  });

  it("never nags when you tick something off", () => {
    for (let i = 0; i < 40; i++) expect(cheerLine("Sahil", 3, i / 40)).not.toMatch(/fail|miss|behind|should|only|left|remaining/i);
    expect(cheerLine("Sahil", 0)).toBe("All done for today. Nice work, Sahil.");
  });
});
