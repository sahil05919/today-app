"use client";
import { useMemo, useState } from "react";
import { friendlyDate, toISO } from "@/lib/dates";
import { fmtMinutes } from "@/lib/other";
import { QUICK_CHIPS } from "@/lib/query";
import { search, type Hit } from "@/lib/search";
import type { AppData, FixedEvent } from "@/lib/types";
import { CalendarEventInfo } from "./CalendarSheet";
import { CategoryChip } from "./CategoryChip";
import { btn, field, Sheet, type Panel, type ViewCtx } from "./ui";

/** The title with the words you typed marked. */
function Marked({ text, marks }: { text: string; marks: Array<[number, number]> }) {
  if (!marks.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

const STATUS_MARK = { upcoming: "○", done: "✓", missed: "!", skipped: "–" } as const;

function Row({ hit, ctx, onOpen }: { hit: Hit; ctx: ViewCtx; onOpen: (hit: Hit) => void }) {
  const e = hit.entry;
  const openable = !!e.openId || !!e.event || e.kind === "learning";
  const editable = e.kind === "task" || e.kind === "occurrence" || e.kind === "event" || e.kind === "logged";
  const body = (
    <>
      <span className={`block text-[15px] font-medium leading-snug ${e.status === "done" ? "text-muted" : ""}`}>
        <span className="mr-1.5 text-muted" aria-hidden="true">
          {STATUS_MARK[e.status]}
        </span>
        <Marked text={e.title} marks={hit.marks} />
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span>
          {friendlyDate(e.date, ctx.today)}
          {e.time ? ` · ${e.time}` : ""}
          {e.minutes && e.kind !== "learning" && e.kind !== "note" ? ` · ${fmtMinutes(e.minutes)}` : ""}
        </span>
        <CategoryChip target={{ key: e.key, title: e.title, cat: e.cat, editable }} />
      </span>
    </>
  );
  return openable ? (
    <button onClick={() => onOpen(hit)} className="block min-h-12 w-full border-b border-line py-2 text-left">
      {body}
    </button>
  ) : (
    <div className="min-h-12 border-b border-line py-2">{body}</div>
  );
}

/** Search: the answer first, then the items behind it. Offline. Opens with the keyboard up. */
export function SearchSheet({ data, ctx, onClose, openPanel }: { data: AppData; ctx: ViewCtx; onClose: () => void; openPanel: (p: Panel) => void }) {
  const [text, setText] = useState("");
  const [event, setEvent] = useState<FixedEvent | null>(null);
  const result = useMemo(() => search(data, text), [data, text]);

  const open = (hit: Hit) => {
    const e = hit.entry;
    if (e.event) setEvent(e.event);
    else if (e.kind === "learning") {
      onClose();
      openPanel("learning");
    } else if (e.openId) ctx.open(e.openId);
  };

  return (
    <Sheet title="Search" onClose={onClose}>
      <input
        autoFocus
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="pbi, walks this month, what's left, passport…"
        aria-label="Search"
        className={field}
      />

      {result.empty ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Try</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_CHIPS.map((c) => (
              <button key={c.label} onClick={() => setText(c.query)} className={`${btn.ghost} min-h-11`}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted">Works offline, in English or Hinglish: “chalna”, “padhai”, “how many walks this month”, “missed last week”, “from gmail”.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4 pb-2">
          {result.answer && (
            <div className="rounded-2xl bg-accent-soft p-4" role="status" aria-label="Answer">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">{result.answer.title}</p>
              {result.answer.lead && <p className="mt-1 text-3xl font-semibold tracking-tight">{result.answer.lead}</p>}
              <div className="mt-1.5 space-y-0.5 text-sm leading-relaxed">
                {result.answer.lines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            </div>
          )}

          {result.auto.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">🤖 What the app did</h3>
              <ul>
                {result.auto.map((a) => (
                  <li key={a.id} className="border-b border-line py-2 text-[15px]">
                    <span className="font-medium">{a.title}</span>
                    <span className="block text-xs text-muted">
                      {a.kind === "added" ? "Added" : a.kind === "moved" ? "Moved" : "Pulled forward"} · {a.src.replace("-", " ")} · {friendlyDate(toISO(new Date(a.at)), ctx.today)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.groups.map((g) => (
            <section key={g.id}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                {g.title} · {g.hits.length + g.more}
              </h3>
              <div>
                {g.hits.map((h) => (
                  <Row key={h.entry.key} hit={h} ctx={ctx} onOpen={open} />
                ))}
              </div>
              {g.more > 0 && <p className="pt-1 text-xs text-muted">and {g.more} more. Add a word or a date to narrow it.</p>}
            </section>
          ))}

          {result.total === 0 && !result.answer && <p className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">Nothing found for “{text.trim()}”. Try fewer words, or add a time like “this month”.</p>}
          {result.total === 0 && result.answer && <p className="text-sm text-muted">No items in this period.</p>}
        </div>
      )}
      {event && <CalendarEventInfo event={event} onClose={() => setEvent(null)} notify={ctx.notify} ctx={ctx} />}
    </Sheet>
  );
}
