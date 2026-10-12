import { seedIfNeeded as real } from "../lib/seed";
import type { AppData, Profile } from "../lib/types";

/**
 * Fixtures written before the "no auto-planning before 11:00" rule: they describe the old, unrestricted planner, so they run with an
 * earliest auto-planning time of 00:00. Tests of the rule itself use the normal default (see tests/earliest.test.ts).
 */
export const seedEarly = (d: AppData, today?: Date): AppData => {
  const s = real(d, today);
  return { ...s, profile: { ...(s.profile ?? {}), earliestAuto: "00:00" } as Profile };
};
