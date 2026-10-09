import { beforeEach, describe, expect, it } from "vitest";
import { billReminders, dueDates } from "../lib/bills";
import { addDays } from "../lib/dates";
import { revertDone } from "../lib/done";
import { correctTick, tickFromText } from "../lib/doneRun";
import { matchDone } from "../lib/doneText";
import { behindAreas } from "../lib/freedom";
import { computeNudges } from "../lib/nudges";
import { planNotifications } from "../lib/notifications/plan";
import { countLabel, streak } from "../lib/progress";
import { planSessions, plannedForDay } from "../lib/schedule";
import { seedIfNeeded } from "../lib/seed";
import { weekProgress } from "../lib/sessions";
import { actions, getData } from "../lib/store";
import { buildTimeline } from "../lib/timeline";
import { understand } from "../lib/understand";
import type { AppData, Area } from "../lib/types";

// Wed 7 Oct 2026, 09:30. The week is Mon 5 … Sun 11. Friday is used where a bill is due the next day.
const WED = new Date(2026, 9, 7, 9, 30);
const FRI = new Date(2026, 9, 9, 9, 30);
const [MON, TUE, THU, SAT] = ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-10"];
const TODAY = "2026-10-07";

const base = (): AppData => seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: new Date(2026, 8, 1).getTime() } }, WED);
const logs = (areaId: string) => (getData().sessions ?? []).filter((l) => l.areaId === areaId);
const pending = (areaId: string, now = WED) => planSessions(getData(), now).filter((s) => s.areaId === areaId && !s.done);
/** Session reminders planned for THIS week (the next 7 days run into the next one, which has its own targets). */
const sessionKeys = (now: Date) => planNotifications(getData(), now).filter((n) => n.kind === "session" && n.key.split(":")[2] <= "2026-10-11").map((n) => n.key);
const progress = (areaId: string) => weekProgress(getData(), TODAY).find((r) => r.area.id === areaId)!;

beforeEach(() => actions.replaceAll(base()));

describe("several sessions a day", () => {
  it("two walks in one day both count; undo removes only that one", () => {
    const a = actions.addSession("walking", TODAY, "manual", WED)!;
    const b = actions.addSession("walking", TODAY, "manual", new Date(WED.getTime() + 3_600_000))!;
    expect(logs("walking")).toHaveLength(2);
    expect(progress("walking").done).toBe(2);
    expect(plannedForDay(getData(), TODAY).filter((s) => s.areaId === "walking" && s.done)).toHaveLength(2);
    actions.removeSession(b.id, WED);
    expect(logs("walking").map((l) => l.id)).toEqual([a.id]);
  });

  it("an extra session removes one future planned session", () => {
    const before = pending("powerbi").length;
    expect(before).toBeGreaterThan(0);
    actions.addSession("powerbi", TODAY, "manual", WED);
    expect(pending("powerbi").length).toBe(before - 1);
  });

  it("progress may go over target without errors", () => {
    for (let i = 0; i < 5; i++) actions.addSession("meditation", TODAY, "manual", WED);
    const r = progress("meditation");
    expect([r.done, r.target, r.over, r.finished]).toEqual([5, 3, 2, true]);
    expect(countLabel(r)).toBe("5/3 ⭐");
    expect(pending("meditation")).toHaveLength(0);
  });

  it("numbers stay in order for backdated sessions", () => {
    actions.addSession("powerbi", TODAY, "manual", WED);
    actions.addSession("powerbi", TUE, "manual", WED);
    actions.addSession("powerbi", MON, "manual", WED);
    const byDate = () => logs("powerbi").sort((a, b) => a.date.localeCompare(b.date));
    expect(byDate().map((l) => [l.date, l.n])).toEqual([[MON, 1], [TUE, 2], [TODAY, 3]]);
    actions.removeSession(byDate()[1].id, WED);
    expect(byDate().map((l) => l.n)).toEqual([1, 2]);
  });
});

describe("tick it anywhere", () => {
  it("backdates a missed session on THAT day, once", () => {
    const r = actions.markDone({ kind: "session", areaId: "meditation", date: TUE }, { when: "backdate", now: WED });
    expect(r.noop).toBe(false);
    expect(logs("meditation")).toMatchObject([{ date: TUE, via: "backdated" }]);
    expect(progress("meditation").done).toBe(1);
    // A backdated day fills the streak and is never counted twice.
    expect(streak(getData(), TODAY).days).toBe(1);
    actions.markDone({ kind: "session", areaId: "meditation", date: TUE }, { when: "backdate", now: WED });
    expect(logs("meditation")).toHaveLength(1);
  });

  it("ticking Thursday's Power BI today counts this week; Thursday's slot and reminder are gone", () => {
    expect(pending("powerbi").some((s) => s.date === THU)).toBe(true);
    expect(sessionKeys(WED)).toContain(`session:powerbi:${THU}`);
    const r = actions.markDone({ kind: "session", areaId: "powerbi", date: THU }, { when: "today", now: WED });
    expect(r.early).toBe(true);
    expect(r.message).toContain("No reminder tomorrow");
    expect(logs("powerbi")).toMatchObject([{ date: TODAY }]);
    expect(progress("powerbi").done).toBe(1);
    expect(pending("powerbi").some((s) => s.date === THU)).toBe(false);
    expect(buildTimeline(getData(), THU, new Date(2026, 9, 8)).items.some((i) => i.kind === "session" && i.areaId === "powerbi")).toBe(false);
    expect(sessionKeys(WED)).not.toContain(`session:powerbi:${THU}`);
    // Undo puts Thursday back exactly.
    actions.undoDone(r.receipt, WED);
    expect(logs("powerbi")).toHaveLength(0);
    expect(pending("powerbi").some((s) => s.date === THU)).toBe(true);
  });

  it("ticking tomorrow's grocery today: no reminder tomorrow, the next one next week", () => {
    expect(billReminders(getData(), "2026-10-09", "2026-10-20").map((r) => r.due)).toContain(SAT);
    const r = actions.markDone({ kind: "bill", id: "grocery", due: SAT }, { when: "today", now: FRI });
    expect(r.message).toContain("Grocery run done early. No reminder tomorrow");
    const due = billReminders(getData(), "2026-10-09", "2026-10-20").filter((x) => x.bill.id === "grocery").map((x) => x.due);
    expect(due).toEqual(["2026-10-17"]);
    expect(planNotifications(getData(), FRI).some((n) => n.key.startsWith(`bill:grocery:${SAT}`))).toBe(false);
  });

  it('an "every 3 days" chore ticked early restarts from today', () => {
    actions.setBills(getData().bills!.map((b) => (b.id === "clean-room" ? { ...b, lastDone: MON } : b)));
    const room = () => getData().bills!.find((b) => b.id === "clean-room")!;
    expect(dueDates(room(), TODAY, addDays(TODAY, 10), TODAY)).toEqual(["2026-10-08"]);
    actions.markDone({ kind: "bill", id: "clean-room", due: "2026-10-08" }, { when: "today", now: WED });
    expect(room().lastDone).toBe(TODAY);
    expect(dueDates(room(), TODAY, addDays(TODAY, 10), TODAY)).toEqual(["2026-10-10"]);
  });

  it("a bill paid early sends no reminders", () => {
    const has = () => planNotifications(getData(), FRI).some((n) => n.kind === "bill" && n.key.startsWith("bill:credit-card"));
    expect(has()).toBe(true);
    const r = actions.markDone({ kind: "bill", id: "credit-card", due: "2026-10-15" }, { when: "today", now: FRI });
    expect(r.message).toContain("paid early");
    expect(has()).toBe(false);
    actions.undoDone(r.receipt, FRI);
    expect(has()).toBe(true);
  });

  it("completing a repeating task early moves it on; undo puts it back", () => {
    const t = actions.addTask({ title: "Water plants", important: false, tags: [], due: "2026-10-09", recur: { freq: "weekly", interval: 1 } });
    const r = actions.markDone({ kind: "task", id: t.id }, { when: "today", now: WED });
    expect(r.early).toBe(true);
    const open = () => getData().tasks.filter((x) => x.status === "open" && x.title === "Water plants").map((x) => x.due);
    expect(open()).toEqual(["2026-10-16"]);
    actions.undoDone(r.receipt, WED);
    expect(open()).toEqual(["2026-10-09"]);
  });

  it("an undo only takes back the tick, not what changed since", () => {
    const d0 = getData();
    const r = actions.markDone({ kind: "session", areaId: "walking", date: TODAY }, { when: "on-its-day", now: WED });
    actions.addGrocery(["Milk"]);
    actions.undoDone(r.receipt, WED);
    expect(getData().grocery).toHaveLength(1);
    expect(getData().sessions ?? []).toHaveLength(0);
    expect(revertDone(d0, r.receipt).sessions ?? []).toHaveLength(0);
  });
});

describe("tick by typing", () => {
  const run = (text: string, now = WED) => {
    const p = understand(text, getData(), now);
    return { p, t: tickFromText(text, p, "Sahil", now) };
  };

  it('"grocery done" ticks the grocery run, early, and says which reminder is gone', () => {
    const { p, t } = run("grocery done", FRI);
    expect(p.kind).toBe("done");
    expect(t!.applied).toMatchObject({ item: "bill:grocery", when: "today" });
    expect(t!.summary).toBe("Grocery run · done early · no reminder tomorrow");
  });

  it('"bought groceries" and "credit card bhar diya" tick the right item', () => {
    expect(run("bought groceries", FRI).t!.applied!.item).toBe("bill:grocery");
    const cc = run("credit card bhar diya", FRI);
    expect(cc.t!.applied).toMatchObject({ item: "bill:credit-card", date: "2026-10-15" });
    expect(cc.t!.summary).toContain("no reminder Thursday");
    expect(planNotifications(getData(), FRI).some((n) => n.key.startsWith("bill:credit-card"))).toBe(false);
  });

  it('"room saaf kar diya" and "finance review done" tick the chores', () => {
    expect(run("room saaf kar diya").t!.applied!.item).toBe("bill:clean-room");
    expect(run("finance review done").t!.applied!.item).toBe("bill:finance-review");
  });

  it('"kal wala Power BI aaj kar liya" ticks yesterday\'s item and logs it today', () => {
    const { p, t } = run("kal wala Power BI aaj kar liya");
    expect(p.kind).toBe("session");
    expect(t!.applied).toMatchObject({ item: "session:powerbi", date: TUE, when: "today" });
    expect(logs("powerbi")).toMatchObject([{ date: TODAY }]);
    // Yesterday's missed one is cleared, not left as "missed".
    expect(plannedForDay(getData(), TUE).some((s) => s.areaId === "powerbi" && !s.done)).toBe(false);
  });

  it('"Thursday ka meditation ho gaya" ticks Thursday\'s session early', () => {
    const { t } = run("Thursday ka meditation ho gaya");
    expect(t!.applied).toMatchObject({ item: "session:meditation", date: THU, when: "today" });
    expect(logs("meditation")).toMatchObject([{ date: TODAY }]);
  });

  it('"did Power BI" ticks one session and counts it', () => {
    const { t } = run("did Power BI");
    expect(t!.applied!.item).toBe("session:powerbi");
    expect(logs("powerbi")).toHaveLength(1);
  });

  it("typing a session again on the same day counts one more (nothing else planned)", () => {
    // Friday evening: Power BI has nothing left planned this week once two are done.
    run("did Power BI", new Date(2026, 9, 9, 8, 0));
    run("did Power BI", new Date(2026, 9, 9, 8, 0));
    run("did Power BI", new Date(2026, 9, 9, 8, 0));
    expect(logs("powerbi").length).toBeGreaterThanOrEqual(3);
    expect(new Set(logs("powerbi").map((l) => l.n)).size).toBe(logs("powerbi").length);
  });

  it("works for a NEW area with no code change: Guitar, 3 a week", () => {
    const guitar: Area = { id: "guitar", name: "Guitar", emoji: "🎸", target: { perWeek: 3, minutes: 30, weekends: false, slots: ["before", "evening", "night"], remind: true } };
    const d = getData();
    actions.setProfile({ ...d.profile!, areas: [...d.profile!.areas, guitar] });
    const guitarKeys = () => sessionKeys(WED).filter((k) => k.startsWith("session:guitar"));
    expect(guitarKeys().length).toBeGreaterThan(0);

    const t1 = run("guitar kiya").t!;
    expect(t1.applied!.item).toBe("session:guitar");
    expect(logs("guitar")).toHaveLength(1);
    actions.addSession("guitar", TUE, "manual", WED);
    expect(guitarKeys().length).toBeGreaterThan(0);
    actions.addSession("guitar", MON, "manual", WED);
    // Three of three: no more planned sessions, no reminders, no behind / neglected nudges.
    expect(progress("guitar").finished).toBe(true);
    expect(pending("guitar")).toHaveLength(0);
    expect(guitarKeys()).toHaveLength(0);
    expect(computeNudges(getData(), new Date(2026, 9, 10, 12)).some((n) => n.areaId === "guitar")).toBe(false);
  });

  it('a "Not this one" fix is learned and used next time', () => {
    // Nothing in the phrase names a thing, so it asks.
    const first = run("swept the floor done");
    expect(first.t!.applied).toBeNull();
    const clean = first.t!.options.find((o) => o.item === "bill:clean-room")!;
    expect(clean).toBeTruthy();
    const fixed = correctTick(first.t!, clean, "Sahil", WED);
    expect(fixed.applied!.item).toBe("bill:clean-room");
    expect(getData().learned!.some((r) => r.item === "bill:clean-room")).toBe(true);
    // Take it back; the phrase now works offline with no question.
    actions.undoDone(fixed.receipt!, WED);
    const next = run("floor swept done");
    expect(next.t!.applied!.item).toBe("bill:clean-room");
    // And it never changes how an ordinary task is filed.
    expect(understand("sweep the floor tomorrow", getData(), WED).kind).not.toBe("done");
  });

  it('a wrong guess can be fixed: "Not this one" undoes it and ticks the other', () => {
    actions.addTask({ title: "Call the bank", important: false, tags: [], due: TODAY });
    const first = run("call done");
    // "call" names both the task and Call family: a tie asks, or picks one; either way the other is on offer.
    const all = first.t!.options.map((o) => o.item);
    expect(all).toContain("bill:family-call");
    const other = first.t!.options.find((o) => o.item === "bill:family-call")!;
    const fixed = correctTick(first.t!, other, "Sahil", WED);
    expect(fixed.applied!.item).toBe("bill:family-call");
    expect(getData().tasks.find((t) => t.title === "Call the bank")!.status).toBe("open");
  });

  it('a bare "done" asks which one; it never guesses', () => {
    const { p, t } = run("done");
    expect(p.kind).toBe("done");
    expect(t!.applied).toBeNull();
    expect(t!.options.length).toBeGreaterThan(0);
    expect(logs("powerbi")).toHaveLength(0);
  });

  it("future talk, negations and ordinary sentences are not ticks", () => {
    expect(matchDone("I will do grocery tomorrow", getData(), WED)).toBeNull();
    expect(matchDone("didn't do power bi", getData(), WED)).toBeNull();
    expect(matchDone("had lunch with Sam", getData(), WED)).toBeNull();
  });
});

describe("target hit = freedom", () => {
  it("celebrates once, offers the freed time once, and extras still count", () => {
    // Two done earlier in the week; one more is planned for Thursday or Friday.
    actions.addSession("meditation", MON, "manual", WED);
    actions.addSession("meditation", TUE, "manual", WED);
    const planned = pending("meditation");
    expect(planned).toHaveLength(1);
    expect(sessionKeys(WED).some((k) => k.startsWith("session:meditation"))).toBe(true);

    const r = actions.markDone({ kind: "session", areaId: "meditation", date: TODAY }, { when: "on-its-day", now: WED });
    expect(r.reached).toEqual(["meditation"]);
    // The rest of the week's sessions, reminders and nudges are gone.
    expect(pending("meditation")).toHaveLength(0);
    expect(sessionKeys(WED).some((k) => k.startsWith("session:meditation"))).toBe(false);
    expect(buildTimeline(getData(), planned[0].date, new Date(`${planned[0].date}T00:00:00`)).items.some((i) => i.kind === "session" && i.areaId === "meditation")).toBe(false);
    expect(computeNudges(getData(), new Date(2026, 9, 10, 12)).some((n) => n.areaId === "meditation")).toBe(false);

    // The freed slot is offered once.
    const offer = getData().settings.freed!;
    expect(offer.areaId).toBe("meditation");
    expect(offer.slot).toMatchObject({ date: planned[0].date, start: planned[0].start });
    const task = actions.answerFreed({ kind: "extra" }, WED)!;
    expect(task).toMatchObject({ due: planned[0].date, countsFor: "meditation" });
    expect(getData().settings.freed).toBeUndefined();

    // More sessions still count (4/3 ⭐) and do not bring the offer back.
    actions.addSession("meditation", TODAY, "manual", WED);
    expect(getData().settings.freed).toBeUndefined();
    const row = progress("meditation");
    expect([row.done, row.over, countLabel(row)]).toEqual([4, 1, "4/3 ⭐"]);
    // Finishing the extra-session task counts it too, and reopening it takes it back.
    actions.toggleDone(task.id, WED);
    expect(progress("meditation").done).toBe(5);
    actions.toggleDone(task.id, WED);
    expect(progress("meditation").done).toBe(4);
  });

  it("an undo below the target forgets the celebration so it can happen again", () => {
    actions.addSession("meditation", MON, "manual", WED);
    actions.addSession("meditation", TUE, "manual", WED);
    const r = actions.markDone({ kind: "session", areaId: "meditation", date: TODAY }, { when: "on-its-day", now: WED });
    expect(getData().settings.freed).toBeTruthy();
    actions.undoDone(r.receipt, WED);
    expect(getData().settings.freed).toBeUndefined();
    actions.markDone({ kind: "session", areaId: "meditation", date: TODAY }, { when: "on-its-day", now: WED });
    expect(getData().settings.freed).toBeTruthy();
  });

  it("other areas that are behind can take the freed time", () => {
    expect(behindAreas(getData(), TODAY, "meditation").map((a) => a.id)).toContain("powerbi");
  });
});
