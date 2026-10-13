import { describe, expect, it } from "vitest";
import { emptyData } from "../lib/backup";
import { seedIfNeeded } from "../lib/seed";
import { shareMyWeek } from "../lib/shareWeek";
import { copyText, shareText } from "../lib/shareText";
import type { AppData, SessionLog, Task } from "../lib/types";

const NOW = new Date(2026, 9, 18, 21, 0); // Sun 18 Oct 2026, 21:00
const TODAY = "2026-10-18";
let n = 0;
const AREA_MIN: Record<string, number> = { powerbi: 60, meditation: 15, job: 40, english: 20, walking: 35 };
const log = (areaId: string, date: string): SessionLog => ({ id: `s${++n}`, areaId, date, minutes: AREA_MIN[areaId], n, at: new Date(`${date}T19:00:00`).getTime(), source: "manual" });
const done = (title: string): Task => ({ id: `t${++n}`, title, important: false, tags: [], steps: [], focus: false, status: "done", createdAt: new Date("2026-10-13T09:00:00").getTime(), completedAt: new Date("2026-10-15T10:00:00").getTime() });
const base = (extra: Partial<AppData> = {}): AppData => ({ ...seedIfNeeded(emptyData(), NOW), ...extra });

// The week of Mon 12 Oct: Power BI 4/4 ✅, Meditation 3/3 ✅, Job 2/5, English 4/7, Walking 2/6; 4 own tasks; Other 7h 50m.
const week = () =>
  base({
    sessions: [
      ...["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((d) => log("powerbi", d)),
      ...["2026-10-12", "2026-10-14", "2026-10-16"].map((d) => log("meditation", d)),
      ...["2026-10-13", "2026-10-15"].map((d) => log("job", d)),
      ...["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-17"].map((d) => log("english", d)),
      ...["2026-10-14", "2026-10-16"].map((d) => log("walking", d)),
    ],
    tasks: [done("Book dentist"), done("Call plumber"), done("Renew photo"), done("Reply to Sam")],
    worklog: [{ id: "w1", date: "2026-10-13", minutes: 390, title: "Building app", sub: "Building", at: 1 }],
  });

describe("7. accountability share", () => {
  it("the summary: done/target per area with ✅ where met, Other, own tasks, a highlight and next week's focus", () => {
    const text = shareMyWeek(week(), TODAY);
    const lines = text.split("\n");
    expect(lines[0]).toBe("My week:");
    expect(lines).toContain("✅ 📊 Power BI 4/4");
    expect(lines).toContain("✅ 🧘 Meditation 3/3");
    expect(lines).toContain("▫️ 🎯 Job Prep & Apply 2/5");
    expect(lines).toContain("▫️ 📖 English Reading 4/7");
    expect(lines).toContain("▫️ 🚶 Walking 2/6");
    expect(lines).toContain("✅ 🧩 Other 7h 50m ✓ (+2h 50m extra 💪)");
    expect(lines).toContain("Own tasks finished: 4");
    expect(lines).toContain("Highlight: 2h 50m of extra work on top of my targets 💪");
    // The two areas furthest behind are next week's focus.
    expect(lines[lines.length - 1]).toMatch(/^Next week I'll focus on .+ and .+\.$/);
    expect(lines[lines.length - 1]).toContain("Job Prep & Apply");
  });

  it("a buddy name changes the greeting", () => {
    expect(shareMyWeek(week(), TODAY, "Rahul").split("\n")[0]).toBe("Hey Rahul, my week:");
    expect(shareMyWeek(week(), TODAY, "  ").split("\n")[0]).toBe("My week:");
  });

  it("every target met says so; a quiet week says nothing false", () => {
    const all = base({
      sessions: [
        ...Array.from({ length: 4 }, (_, i) => log("powerbi", `2026-10-1${2 + i}`)),
        ...Array.from({ length: 3 }, (_, i) => log("meditation", `2026-10-1${2 + i}`)),
        ...Array.from({ length: 5 }, (_, i) => log("job", `2026-10-1${2 + i}`)),
        ...Array.from({ length: 7 }, (_, i) => log("english", `2026-10-1${2 + i}`)),
        ...Array.from({ length: 6 }, (_, i) => log("walking", `2026-10-1${2 + i}`)),
      ],
      worklog: [{ id: "w1", date: "2026-10-13", minutes: 300, title: "x", sub: "Other", at: 1 }],
    });
    const text = shareMyWeek(all, TODAY);
    expect(text).toContain("Highlight: every target met 🎉");
    expect(text).toContain("Next week: keep the rhythm.");
    const quiet = shareMyWeek(base(), TODAY);
    expect(quiet).not.toContain("Highlight");
    expect(quiet).toContain("Own tasks finished: 0");
  });

  it("is friendly, short, and has no private details", () => {
    const text = shareMyWeek(week(), TODAY, "Rahul");
    expect(text.split("\n").length).toBeLessThan(16);
    expect(text).not.toMatch(/https?:|@|Pinnacle|password/i);
  });

  it("nothing is sent by the app: sharing only hands text to the share sheet, or copies it", async () => {
    const calls: string[] = [];
    const nav = (global as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, "navigator", { value: { share: async (d: { text: string }) => void calls.push(d.text), clipboard: { writeText: async (t: string) => void calls.push("copy:" + t) } }, configurable: true });
    expect(await shareText("hello", "t")).toBe("shared");
    expect(await copyText("x")).toBe(true);
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t: string) => void calls.push("copy2:" + t) } }, configurable: true });
    expect(await shareText("no sheet")).toBe("copied");
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    expect(calls).toEqual(["hello", "copy:x", "copy2:no sheet"]);
  });
});
