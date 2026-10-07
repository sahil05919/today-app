import { DEFAULT_RHYTHM, DEFAULT_SLOTS } from "./defaults";
import type { Area, Profile, Shortcut } from "./types";

export const DEFAULT_AREAS: Area[] = [
  { id: "work", name: "Work", emoji: "💼", isWork: true },
  { id: "career", name: "Career", emoji: "🚀" },
  { id: "health", name: "Health", emoji: "💪", balance: true },
  { id: "family", name: "Family", emoji: "👨‍👩‍👧", balance: true },
  { id: "admin", name: "Admin", emoji: "📄" },
  { id: "fun", name: "Fun", emoji: "🎈", balance: true },
];

export function defaultProfile(): Profile {
  return {
    setupDone: false,
    name: "Sahil",
    officeDays: [1],
    slots: DEFAULT_SLOTS.map((x) => ({ ...x })),
    rhythm: DEFAULT_RHYTHM.map((x) => ({ ...x })),
    workDays: [1, 2, 3, 4, 5],
    workStart: "09:00",
    workEnd: "17:30",
    lunchStart: "13:00",
    lunchMin: 45,
    commuteToMin: 30,
    commuteFromMin: 30,
    bestFocus: "morning",
    gymDays: [],
    gymStart: "18:30",
    gymMin: 60,
    quietStart: "22:00",
    quietEnd: "07:30",
    morningCheckIn: "08:00",
    taskCheckIn: "19:00",
    eveningWrap: "21:00",
    areas: DEFAULT_AREAS.map((a) => ({ ...a })),
    shortcuts: [],
    eventLeadMin: 60,
    nudgeTime: "21:00",
    reviewTime: "18:30",
    breakStart: "17:00",
    breakEnd: "18:00",
    bufferMin: 10,
    eveningCapMin: 150,
    officeCommuteMin: 45,
    sleepStart: "23:00",
    wakeTime: "06:00",
    hideMic: false,
    calendarSync: true,
    notify: { morning: true, taskCheckIns: true, wrap: true, reminders: true, slots: true, events: true, bills: true, nudges: true, review: true },
  };
}

/** Fills any gaps (older saves, partial imports) from the defaults. */
export function withDefaults(p?: Partial<Profile>): Profile {
  const d = defaultProfile();
  return {
    ...d,
    ...p,
    notify: { ...d.notify, ...p?.notify },
    areas: p?.areas?.length ? p.areas : d.areas,
    shortcuts: p?.shortcuts ?? [],
    slots: p?.slots?.length ? p.slots : d.slots,
    rhythm: p?.rhythm ?? d.rhythm,
    name: p?.name ?? d.name,
    officeDays: p?.officeDays ?? d.officeDays,
  };
}

/** "HH:mm" → minutes after midnight */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** minutes after midnight → "HH:mm" (wraps around 24h) */
export function toHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const isWorkDay = (p: Profile, dow: number) => p.workDays.includes(dow);

/** Phrases that always work, computed from the routine: "office ke baad" = after work + commute home. */
export function builtInShortcuts(p: Profile): Shortcut[] {
  const afterWork = toHHMM(toMin(p.workEnd) + p.commuteFromMin);
  return [
    ...["office ke baad", "ऑफिस के बाद", "after work", "after office"].map((phrase) => ({ phrase, time: afterWork })),
    ...["lunch mein", "lunch me", "लंच में", "at lunch"].map((phrase) => ({ phrase, time: p.lunchStart })),
    ...["gym ke baad", "जिम के बाद"].map((phrase) => ({ phrase, time: toHHMM(toMin(p.gymStart) + p.gymMin) })),
  ];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LET = "\\p{L}\\p{M}\\p{N}_";

/** Replaces personal phrases with a clock time the date parser understands ("at 18:30"). Longest phrase wins. */
export function expandShortcuts(text: string, p: Profile): string {
  const all = [...p.shortcuts, ...builtInShortcuts(p)]
    .filter((s) => s.phrase.trim() && /^\d{2}:\d{2}$/.test(s.time))
    .sort((a, b) => b.phrase.length - a.phrase.length);
  let out = text;
  for (const s of all) {
    const re = new RegExp(`(?<![${LET}])${esc(s.phrase.trim()).replace(/\s+/g, "\\s+")}(?![${LET}])`, "giu");
    out = out.replace(re, `at ${s.time}`);
  }
  return out;
}

/** Finds an area by name or id (case-insensitive). */
export function findArea(areas: Area[], key: string): Area | undefined {
  const k = key.toLowerCase();
  return areas.find((a) => a.id === k || a.name.toLowerCase() === k);
}
