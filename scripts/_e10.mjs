import fs from "node:fs";
const edit = (p, pairs) => {
  let s = fs.readFileSync(p, "utf8");
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(p + " missing: " + a.slice(0, 60)); s = s.replace(a, () => b); }
  fs.writeFileSync(p, s);
};
edit("lib/brief.ts", [
  [`export function tonightBody(tl: Timeline): string {`, `export function tonightBody(tl: Timeline, digest?: string | null): string {`],
  [`  return names.length ? \`Tonight: \${names.join(", ")}. Anything from email to add?\` : "A free evening. Anything from email to add?";`, `  // The Gmail add-on's digest ("3 emails need you") replaces the generic nudge to share something from email.
  if (digest) return names.length ? \`Tonight: \${names.join(", ")}. \${digest}.\` : \`A free evening. \${digest}.\`;
  return names.length ? \`Tonight: \${names.join(", ")}. Anything from email to add?\` : "A free evening. Anything from email to add?";`],
]);
edit("lib/notifications/plan.ts", [
  [`import { eventsOn } from "../fixed";`, `import { eventsOn, isEventDone, markOf } from "../fixed";\nimport { digestLine } from "../inbox";`],
  [`    for (const e of data.events ?? []) {
      if (!e.start || e.date < today || e.date > horizonDay) continue;
      push({
        key: \`event:\${e.id}\`,`, `    for (const e of remindable(data)) {
      if (!e.start || e.date < today || e.date > horizonDay) continue;
      push({
        key: \`event:\${e.id}\`,`],
  [`  for (const e of data.events ?? []) {
    if (!e.shift || !e.start || e.date < today || e.date > horizonDay) continue;`, `  for (const e of remindable(data)) {
    if ((!e.shift && !e.remind) || !e.start || e.date < today || e.date > horizonDay) continue;`],
  [`body: tonightBody(timelineOf(day)),`, `body: tonightBody(timelineOf(day), digestLine(data, day)),`],
  [`export function planNotifications(`, `/**
 * The events that get reminders: the ones made in Today, plus the add-on's events in the phone calendar whose notes carry
 * #today-remind (unless ticked off or hidden). Other phone-calendar events keep their old behaviour: no reminder from Today.
 */
function remindable(data: AppData) {
  const tagged = (data.calendarEvents ?? []).filter((e) => e.remind && !isEventDone(data, e) && !markOf(data, e)?.hidden);
  return [...(data.events ?? []), ...tagged];
}

export function planNotifications(`],
]);
