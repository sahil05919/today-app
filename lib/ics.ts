import { addDays, fromISO } from "./dates";
import type { Task } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (iso: string) => iso.replace(/-/g, "");

function localStamp(date: string, time: string, plusMin = 0): string {
  const d = fromISO(date);
  const [h, m] = time.split(":").map(Number);
  d.setHours(h, m + plusMin, 0, 0);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = " " + rest.slice(73);
  }
  out.push(rest);
  return out.join("\r\n");
}

function description(task: Task): string {
  const parts: string[] = [];
  if (task.notes) parts.push(task.notes);
  if (task.steps.length) parts.push(task.steps.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.title}`).join("\n"));
  return parts.join("\n\n");
}

export function buildICS(task: Task): string {
  if (!task.due) throw new Error("Task needs a date first");
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Today//Task app//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT"];
  lines.push(`UID:${task.id}@today.app`, `DTSTAMP:${stamp}`);
  if (task.dueTime) {
    const dur = task.estimateMin ?? 30;
    lines.push(`DTSTART:${localStamp(task.due, task.dueTime)}`, `DTEND:${localStamp(task.due, task.dueTime, dur)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymd(task.due)}`, `DTEND;VALUE=DATE:${ymd(addDays(task.due, 1))}`);
  }
  lines.push(`SUMMARY:${esc((task.important ? "! " : "") + task.title)}`);
  const desc = description(task);
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  // Reminder: 30 min before for timed tasks, 9am on the day for all-day tasks.
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(task.title)}`,
    task.dueTime ? "TRIGGER:-PT30M" : "TRIGGER;RELATED=START:PT9H",
    "END:VALARM",
  );
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(task: Task): string {
  if (!task.due) throw new Error("Task needs a date first");
  const dates = task.dueTime
    ? `${localStamp(task.due, task.dueTime)}/${localStamp(task.due, task.dueTime, task.estimateMin ?? 30)}`
    : `${ymd(task.due)}/${ymd(addDays(task.due, 1))}`;
  const p = new URLSearchParams({ action: "TEMPLATE", text: task.title, dates, details: description(task) });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadICS(task: Task) {
  const safe = task.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "task";
  downloadText(`${safe}.ics`, buildICS(task), "text/calendar;charset=utf-8");
}
