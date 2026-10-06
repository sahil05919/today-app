import type { Area, Bill, BoredIdea, RhythmItem, Slot } from "./types";

/** Bump when new default areas / rhythm should be offered to existing installs (see lib/seed.ts). */
export const SEED_VERSION = 3;

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** Times of day where sessions can go. Edit in Settings → Daily rhythm. */
export const DEFAULT_SLOTS: Slot[] = [
  { id: "before", name: "Before work", start: "08:00", end: "09:00", days: WEEKDAYS },
  // The walk (~19:30, 35 min) runs a little past 20:00, so the window allows for it.
  { id: "evening", name: "Evening", start: "18:00", end: "20:15", days: EVERY_DAY },
  { id: "night", name: "Build time", start: "20:30", end: "22:00", days: EVERY_DAY },
];

/** Gentle pings through the day. Everything is editable and can be switched off. */
export const DEFAULT_RHYTHM: RhythmItem[] = [
  {
    id: "midday",
    label: "Midday check",
    time: "13:00",
    days: WEEKDAYS,
    enabled: true,
    kind: "nudge",
    message: "Quick check, {name}: water, stretch, and how's the day going?",
  },
  {
    id: "wrap-work",
    label: "Wrap up work",
    time: "17:00",
    days: WEEKDAYS,
    enabled: true,
    kind: "nudge",
    message: "Time to wrap up work, {name}. Close the laptop on a good note.",
  },
  {
    id: "emails",
    label: "Sort emails",
    time: "20:00",
    days: EVERY_DAY,
    enabled: true,
    kind: "chore",
    message: "Have you sorted your email, {name}?",
  },
];

/** The areas with a weekly session target, plus a catch-all. */
export const SESSION_AREAS: Area[] = [
  {
    id: "powerbi",
    name: "Power BI",
    emoji: "📊",
    target: { perWeek: 4, minutes: 60, weekends: false, slots: ["evening", "before"], remind: true, order: 1 },
  },
  {
    id: "meditation",
    name: "Meditation",
    emoji: "🧘",
    target: { perWeek: 3, minutes: 15, weekends: false, slots: ["before"], remind: true, order: 0 },
  },
  {
    id: "job",
    name: "Job Prep & Apply",
    emoji: "🎯",
    target: {
      perWeek: 5,
      minutes: 40,
      weekends: false,
      slots: ["night"],
      variants: ["Job Prep", "Job Apply"],
      remind: true,
      order: 1,
    },
  },
  {
    id: "english",
    name: "English Reading",
    emoji: "📖",
    target: { perWeek: 7, minutes: 20, weekends: true, slots: ["night"], remind: true, order: 2 },
  },
  {
    id: "walking",
    name: "Walking",
    emoji: "🚶",
    target: { perWeek: 6, minutes: 35, weekends: true, slots: ["evening"], at: "19:30", remind: true, order: 2 },
  },
  { id: "others", name: "Others", emoji: "📥" },
];

/**
 * Bills, recurring admin and weekend chores. `remindDaysBefore` counts back from the due date, so rent
 * (due on the 1st) reminds you on the 28th in a 30-day month and the 29th in a 31-day month.
 */
export const DEFAULT_BILLS: Bill[] = [
  {
    id: "rent",
    name: "Rent (cash)",
    kind: "bill",
    schedule: { type: "monthly", day: 1 },
    remindDaysBefore: [3],
    time: "18:00",
    autopay: false,
    enabled: true,
    note: "Time to withdraw cash for rent, {name}. It's due on the 1st.",
  },
  {
    id: "credit-card",
    name: "Credit card bill",
    kind: "bill",
    schedule: { type: "monthly", day: 15 },
    remindDaysBefore: [2, 0],
    time: "18:00",
    autopay: false,
    enabled: true,
    note: "Your credit card bill is due on the 15th, {name}.",
  },
  {
    id: "mobile",
    name: "Mobile bill",
    kind: "bill",
    schedule: { type: "monthly", day: 1 },
    remindDaysBefore: [],
    time: "18:00",
    autopay: true,
    enabled: true,
    note: "On autopay. Nothing to do.",
  },
  {
    id: "clean-room",
    name: "Clean room",
    kind: "chore",
    schedule: { type: "every", days: 3 },
    remindDaysBefore: [0],
    time: "17:30",
    autopay: false,
    enabled: true,
    note: "Time to clean your room, {name}.",
  },
  {
    id: "grocery",
    name: "Grocery run",
    kind: "chore",
    schedule: { type: "weekly", dow: 6 },
    remindDaysBefore: [0],
    time: "11:00",
    autopay: false,
    enabled: true,
    note: "Grocery run today, {name}.",
    groceries: true,
  },
  {
    id: "finance-review",
    name: "Finance review",
    kind: "chore",
    schedule: { type: "weekly", dow: 0 },
    remindDaysBefore: [0],
    time: "17:00",
    autopay: false,
    enabled: true,
    note: "A quick finance review, {name}: bills, spending, savings. Fifteen minutes.",
  },
  {
    id: "family-call",
    name: "Call family",
    kind: "chore",
    schedule: { type: "weekly", dow: 0 },
    remindDaysBefore: [0],
    time: "12:00",
    autopay: false,
    enabled: true,
    note: "Call or check in with family, {name}.",
  },
];

/** "Getting bored?": ideas to pull from when you have free time. */
export const DEFAULT_BORED: BoredIdea[] = [
  { id: "b1", text: "Read something new", areaId: "english" },
  { id: "b2", text: "Learn one new Power BI trick", areaId: "powerbi" },
  { id: "b3", text: "Go for a short walk", areaId: "walking" },
  { id: "b4", text: "Call a friend", areaId: "family" },
  { id: "b5", text: "Tidy one drawer or shelf" },
  { id: "b6", text: "Plan a weekend outing", areaId: "fun" },
  { id: "b7", text: "Write down three things going well" },
];

/**
 * The rest of your categories. Together with the session areas and the originals this gives:
 * Work, Career, Health, Learning, Home, Shopping, Finance, Family & Friends, Travel, Admin, Going out,
 * Ideas & Notes, Others (plus Power BI / Meditation / Job / English / Walking with their weekly targets).
 */
export const EXTRA_AREAS: Area[] = [
  { id: "learning", name: "Learning", emoji: "📚" },
  { id: "home", name: "Home", emoji: "🏠" },
  { id: "shopping", name: "Shopping", emoji: "🛍️" },
  { id: "finance", name: "Finance", emoji: "💰" },
  { id: "travel", name: "Travel", emoji: "✈️" },
  { id: "notes", name: "Ideas & Notes", emoji: "📝" },
];

/** Tidy order for the area list. Unknown (your own) areas go before "Others". */
export const AREA_ORDER = [
  "powerbi",
  "meditation",
  "job",
  "english",
  "walking",
  "work",
  "career",
  "health",
  "learning",
  "home",
  "shopping",
  "finance",
  "family",
  "travel",
  "admin",
  "fun",
  "notes",
];
