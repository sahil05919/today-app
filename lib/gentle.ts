import type { Nudge } from "./nudges";

/**
 * Gentle nudges, in a friendly voice. The computing stays in lib/nudges.ts; this only decides the words, so the home screen
 * can show ONE of them below the to-do list without ever sounding like a telling-off.
 */
const pick = <T,>(list: T[], seed: number) => list[Math.abs(seed) % list.length];

export function friendlyNudge(n: Nudge, today: string): { text: string; button: string } {
  const seed = Math.floor(Date.parse(today) / 86_400_000);
  const area = n.areaName ?? "That";
  switch (n.kind) {
    case "neglect":
      return {
        text: n.days
          ? pick([`${area} hasn't had a turn in ${n.days} days. Even ten minutes counts 🙂`, `A small thought: ${area} has been quiet for ${n.days} days. Whenever you're ready.`], seed)
          : `${area} hasn't started yet. A short one today would be a lovely start 🙂`,
        button: "See my week",
      };
    case "behind":
      return {
        text: n.fit === 0
          ? `${area} is a little behind this week (${n.done} of ${n.target}). Want to find a gap for it?`
          : `${area} is a little behind (${n.done} of ${n.target}), and ${n.fit} more ${n.fit === 1 ? "fits" : "fit"} this week. One small session helps 🌱`,
        button: "See my week",
      };
    case "empty-day":
      return { text: "Tomorrow looks open. Add something small if you like.", button: "Add something" };
    default:
      return { text: n.text, button: "Set them" };
  }
}
