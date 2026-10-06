import type { Area } from "./types";

/**
 * Offline guess at which area a task belongs to, from its words. Only suggests areas you actually have;
 * anything unclear goes to "Others" (if you keep that area). Tap the chip on the task to fix it.
 */
const RULES: Array<[areaId: string, pattern: RegExp]> = [
  ["powerbi", /\b(power\s?bi|dax|power query|dashboard)\b/i],
  ["meditation", /\b(meditat\w*|mindful\w*|breathing)\b/i],
  ["job", /\b(job|jobs|apply|applications?|cv|resume|interview|linkedin|recruiter|cover letter)\b/i],
  ["english", /\b(read|reading|book|novel|article|vocabulary|english)\b/i],
  ["walking", /\b(walk|walking|stroll|hike|outing)\b/i],
  ["health", /\b(gym|doctor|dentist|workout|yoga|physio|medicine|dawai|vitamin\w*)\b/i],
  ["admin", /\b(rent|bill|tax|insurance|bank|form|paperwork|renew|council|credit card|passport|visa|cash)\b/i],
  ["family", /\b(mum|mom|mummy|mama|dad|papa|family|sister|brother|parents|gran|grandma|nani|dadi)\b/i],
  ["fun", /\b(movie|film|party|game|concert|trip|holiday|friends?)\b/i],
  ["work", /\b(client|meeting|standup|stand-up|invoice|deck|presentation|manager)\b/i],
];

export function inferArea(title: string, areas: Area[]): string | undefined {
  const have = new Set(areas.map((a) => a.id));
  for (const [id, re] of RULES) if (have.has(id) && re.test(title)) return id;
  return have.has("others") ? "others" : undefined;
}
