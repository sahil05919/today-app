import { toISO } from "./dates";
import { DEFAULT_BILLS, DEFAULT_BORED, SEED_VERSION, SESSION_AREAS } from "./defaults";
import { toMin, withDefaults } from "./profile";
import type { AppData } from "./types";

/**
 * One-time defaults, applied in steps the first time an install loads each version. Anything you've
 * already changed is left alone, and a step never runs twice (so deleting an area or a bill sticks).
 *
 *  1. your session areas (Power BI, Meditation, …) next to the ones you have, and hours that fit your routine
 *     (WFH 09:00–17:00, end-of-day check at 22:00)
 *  2. bills, chores and weekend admin, plus the "Getting bored?" ideas
 */
export function seedIfNeeded(d: AppData, today = new Date()): AppData {
  const from = d.settings.seeded ?? 0;
  if (from >= SEED_VERSION) return d;
  let out = d;

  if (from < 1) {
    const p = withDefaults(out.profile);
    const have = new Set(p.areas.map((a) => a.id));
    // Your session areas go first (they're what the app is built around), "Others" last.
    const fresh = SESSION_AREAS.filter((a) => !have.has(a.id)).map((a) => structuredClone(a));
    const areas = [...fresh.filter((a) => a.id !== "others"), ...p.areas, ...fresh.filter((a) => a.id === "others")];

    const untouchedWork = p.workEnd === "17:30" && p.commuteToMin === 30 && p.commuteFromMin === 30;
    const eveningWrap = p.eveningWrap === "21:00" ? "22:00" : p.eveningWrap;
    // The end-of-day check must not land inside quiet hours.
    const quietStart = p.quietStart === "22:00" && toMin(eveningWrap) >= toMin("22:00") ? "23:00" : p.quietStart;

    out = {
      ...out,
      profile: {
        ...p,
        areas,
        eveningWrap,
        quietStart,
        ...(untouchedWork ? { workEnd: "17:00", commuteToMin: 0, commuteFromMin: 0 } : {}),
      },
    };
  }

  if (from < 2) {
    const start = toISO(today);
    out = {
      ...out,
      // "Every N days" chores start counting from today.
      bills: out.bills ?? DEFAULT_BILLS.map((b) => ({ ...structuredClone(b), startDate: b.schedule.type === "every" ? start : undefined })),
      bored: out.bored ?? structuredClone(DEFAULT_BORED),
    };
  }

  return { ...out, settings: { ...out.settings, seeded: SEED_VERSION } };
}
