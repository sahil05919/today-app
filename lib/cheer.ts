/**
 * Small, warm lines for the moment you tick something off. Never preachy, never guilt-tripping:
 * no streak threats, no "you should", no counting what's left unless it's good news.
 */
const LINES = [
  "Nice one, {name}.",
  "Done. One less thing.",
  "Lovely, {name}.",
  "Ticked off.",
  "Good going.",
  "That's sorted.",
  "Smooth, {name}.",
  "Easy. Done.",
  "Well done.",
  "Off your plate.",
];

const fill = (s: string, name: string) => s.replaceAll("{name}", name || "friend");

/** A short encouraging line after finishing something. `left` is how many items remain today. */
export function cheerLine(name: string, left: number, pick: number = Math.random()): string {
  if (left === 0) return fill("All done for today. Nice work, {name}.", name);
  return fill(LINES[Math.floor(pick * LINES.length) % LINES.length], name);
}

/** The evening line: "Today: 5 of 6 done. Nice work, Sahil." Calm when it was a quiet day. */
export function eveningLine(name: string, done: number, total: number): string {
  if (total === 0) return fill("A quiet day. Rest well, {name}.", name);
  if (done === 0) return fill("Today was a gentle one. Rest well, {name}.", name);
  if (done >= total) return fill(`Today: ${done} of ${total} done. Well done, {name}.`, name);
  return fill(`Today: ${done} of ${total} done. Nice work, {name}.`, name);
}

/** "Good morning, Sahil" by time of day. */
export function greetingFor(name: string, now: Date = new Date()): string {
  const h = now.getHours();
  const who = name ? `, ${name}` : "";
  if (h < 5) return `Still up${who}?`;
  if (h < 12) return `Good morning${who}`;
  if (h < 17) return `Good afternoon${who}`;
  if (h < 22) return `Good evening${who}`;
  return `Good night${who}`;
}
