import { describe, expect, it } from "vitest";
import { migrate } from "../lib/backup";
import { seedIfNeeded } from "../lib/seed";
import { parseCapture } from "../lib/parse";
import { builtInShortcuts, defaultProfile, expandShortcuts, toHHMM, toMin, withDefaults } from "../lib/profile";

const NOW = new Date(2026, 9, 6, 10, 0); // Tue 6 Oct 2026, 10:00
const me = () => ({ ...defaultProfile(), workEnd: "17:30", commuteFromMin: 30, lunchStart: "13:00" });

describe("personal Hinglish shortcuts", () => {
  it("'office ke baad' = after your work hours plus the commute home", () => {
    const p = parseCapture("kal office ke baad gym bag pack karna hai", NOW, me());
    expect(p).toMatchObject({ title: "Gym bag pack", due: "2026-10-07", dueTime: "18:00" });
  });
  it("'lunch mein' = your lunch break", () => {
    expect(parseCapture("lunch mein dentist ko call", NOW, me())).toMatchObject({ title: "Dentist ko call", due: "2026-10-06", dueTime: "13:00" });
  });
  it("follows the profile: change work hours and the time moves", () => {
    const p = { ...me(), workEnd: "19:00", commuteFromMin: 15 };
    expect(parseCapture("kal office ke baad call mum", NOW, p).dueTime).toBe("19:15");
  });
  it("custom phrases", () => {
    const p = { ...me(), shortcuts: [{ phrase: "nashte ke baad", time: "09:15" }] };
    expect(parseCapture("kal nashte ke baad dawai", NOW, p)).toMatchObject({ title: "Dawai", dueTime: "09:15" });
  });
  it("Devanagari phrases work too", () => {
    expect(parseCapture("कल ऑफिस के बाद फोन करना है", NOW, me())).toMatchObject({ title: "फोन", dueTime: "18:00" });
  });
  it("leaves unrelated text alone", () => {
    expect(expandShortcuts("after lunchtime sale", me())).toBe("after lunchtime sale");
    expect(builtInShortcuts(me()).some((s) => s.phrase === "office ke baad" && s.time === "18:00")).toBe(true);
  });
});

describe("life areas", () => {
  it("@area tags a task and is removed from the title", () => {
    expect(parseCapture("@family mummy ko call kal", NOW, me())).toMatchObject({ area: "family", title: "Mummy ko call", due: "2026-10-07" });
    expect(parseCapture("Send invoice @Work", NOW, me()).area).toBe("work");
  });
  it("unknown @names are left alone", () => {
    const withOthers = { ...me(), areas: [...me().areas, { id: "others", name: "Others", emoji: "📥" }] };
    const p = parseCapture("email @sam about lunch", NOW, withOthers);
    expect(p.area).toBe("others"); // unclear → Others
    expect(parseCapture("email @sam about lunch", NOW, me()).area).toBeUndefined(); // no Others area to use
    expect(p.title).toContain("@sam");
  });
  it("areas are editable", () => {
    const p = { ...me(), areas: [{ id: "side", name: "Side project", emoji: "🛠️" }, ...me().areas] };
    // names with spaces can still be matched by id
    expect(parseCapture("ship it @side", NOW, p).area).toBe("side");
  });
});

describe("profile helpers + backup", () => {
  it("time maths", () => {
    expect(toMin("17:30")).toBe(1050);
    expect(toHHMM(1050 + 30)).toBe("18:00");
    expect(toHHMM(-30)).toBe("23:30");
  });
  it("older saves with no profile still load; partial profiles get defaults", () => {
    const d = migrate({ tasks: [], settings: { firstRunAt: 1 } });
    expect(d.profile).toBeUndefined();
    expect(withDefaults(undefined).areas).toHaveLength(6);
    const p = migrate({ tasks: [], settings: {}, profile: { workStart: "08:00", quietStart: "bad", areas: [] } }).profile!;
    expect(p.workStart).toBe("08:00");
    expect(p.quietStart).toBe("22:00");
    expect(p.areas).toHaveLength(6);
  });
});

describe("area guessing", () => {
  const seeded = seedIfNeeded({ version: 1, tasks: [], settings: { firstRunAt: 1 } }).profile!;
  const area = (text: string) => parseCapture(text, NOW, seeded).area;
  it("files tasks by their words, in English or Hinglish", () => {
    expect(area("finish power bi dashboard")).toBe("powerbi");
    expect(area("kal meditation karna hai")).toBe("meditation");
    expect(area("apply to 3 jobs")).toBe("job");
    expect(area("read two chapters of a book")).toBe("english");
    expect(area("evening walk")).toBe("walking");
    expect(area("pay rent in cash")).toBe("admin");
    expect(area("mummy ko call")).toBe("family");
  });
  it("sends anything unclear to Others, and an explicit @area always wins", () => {
    expect(area("fix the thing")).toBe("others");
    expect(area("power bi dashboard @fun")).toBe("fun");
  });
});
