"use client";
import { formatMinutes, friendlyDate } from "@/lib/dates";
import { recurLabel } from "@/lib/recur";
import type { ParsedCapture } from "@/lib/parse";
import { TEMPLATES } from "@/lib/templates";
import type { Area, ISODate } from "@/lib/types";
import { Chip } from "./ui";

const soft = (s: string) => (/^(Today|Tomorrow|Yesterday)$/.test(s) ? s.toLowerCase() : s);

/** The little chips that show, as you type, how a capture is being understood. */
export function ParsePreview({
  parsed,
  today,
  defaultDate,
  areas,
}: {
  parsed: ParsedCapture;
  today: ISODate;
  defaultDate?: ISODate;
  areas?: Area[];
}) {
  const due = parsed.due ?? defaultDate;
  const area = parsed.area ? areas?.find((a) => a.id === parsed.area) : undefined;
  const wrap = "anim-fade flex flex-wrap items-center gap-1.5 px-1";

  if (parsed.kind === "grocery") {
    return (
      <div className={wrap}>
        <Chip tone="accent">🛒 Shopping list</Chip>
        {parsed.groceryItems?.map((g) => (
          <Chip key={g} tone="accent">
            {g}
          </Chip>
        ))}
      </div>
    );
  }
  if (parsed.kind === "session") {
    const a = areas?.find((x) => x.id === parsed.session?.areaId);
    return (
      <div className={wrap}>
        <Chip tone="accent">
          ✓ Counts as a session: {a?.emoji} {a?.name}
        </Chip>
        {parsed.session && parsed.session.date !== today && <Chip tone="accent">{soft(friendlyDate(parsed.session.date, today))}</Chip>}
      </div>
    );
  }
  if (parsed.kind === "paid") {
    return (
      <div className={wrap}>
        <Chip tone="accent">💳 Marks {parsed.title} as paid</Chip>
      </div>
    );
  }
  if (parsed.kind === "note") {
    const a = areas?.find((x) => x.id === parsed.area);
    return (
      <div className={wrap}>
        <Chip tone="accent">📝 Saved as a note</Chip>
        {a && (
          <Chip tone="accent">
            {a.emoji} {a.name}
          </Chip>
        )}
      </div>
    );
  }
  if (parsed.kind === "event") {
    const ev = parsed.event;
    return (
      <div className={wrap}>
        <Chip tone="accent">📌 Fixed event</Chip>
        <Chip tone="accent">
          {soft(friendlyDate(due ?? today, today))}
          {ev?.start ? ` · ${ev.start}${ev.end ? "–" + ev.end : ""}` : " · all day"}
        </Chip>
        {ev?.countsFor && <Chip tone="accent">counts as a session</Chip>}
        <Chip>sessions move around it</Chip>
      </div>
    );
  }
  return (
    <div className={wrap}>
      <Chip tone="accent">
        {due ? soft(friendlyDate(due, today)) + (parsed.dueTime ? ` · ${parsed.dueTime}` : "") : "→ Later (set a date after)"}
      </Chip>
      {parsed.slotReason && <Chip>suggested: {parsed.slotReason}</Chip>}
      {parsed.recur && <Chip tone="accent">↻ {recurLabel(parsed.recur)}</Chip>}
      {area && (
        <Chip tone="accent">
          {area.emoji} {area.name}
        </Chip>
      )}
      {parsed.important && <Chip tone="accent">! important</Chip>}
      {parsed.estimateMin && <Chip tone="accent">{formatMinutes(parsed.estimateMin)}</Chip>}
      {parsed.template && (
        <Chip tone="accent">
          {TEMPLATES[parsed.template].emoji} {TEMPLATES[parsed.template].label}
        </Chip>
      )}
      {parsed.tags.map((t) => (
        <Chip key={t} tone="accent">
          #{t}
        </Chip>
      ))}
    </div>
  );
}
