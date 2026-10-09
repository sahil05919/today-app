"use client";
import { useEffect, useState } from "react";
import { quoteAtSlot, quoteById, quoteStateOf } from "@/lib/quoteBag";
import type { Quote } from "@/lib/quotes/types";
import { actions, getData, useData } from "@/lib/store";
import type { ISODate } from "@/lib/types";
import { buzz } from "@/lib/haptics";
import { btn, Sheet } from "./ui";

const HEART = (on: boolean) => (on ? "♥" : "♡");

/** The quote a given day shows: its pinned place in the bag, or the next free one (which is what pinning it will take). */
function quoteOfDay(date: ISODate): Quote {
  const st = quoteStateOf(getData());
  return quoteAtSlot(st.seed, st.assigned[date] ?? st.cursor);
}

/** A calm, full-screen quote. ♥ Save keeps it under Menu → Quotes; Another one takes the next unused quote. */
export function QuoteCard({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const data = useData();
  const [quote, setQuote] = useState<Quote>(() => quoteOfDay(date));
  // Pin the day's quote to its place, so it can never change or come round again.
  useEffect(() => {
    actions.assignQuote(date);
  }, [date]);
  const saved = !!data && quoteStateOf(data).saved.includes(quote.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="A thought for you" className="anim-fade fixed inset-0 z-[80] flex flex-col bg-bg px-7 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex justify-end">
        <button onClick={onClose} aria-label="Close" className="flex h-12 w-12 items-center justify-center rounded-full text-2xl text-muted hover:bg-surface">
          ×
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-accent">{quote.mood.replace("-", " ")}</p>
        <blockquote key={quote.id} className="anim-fade break-words text-[26px] font-medium leading-snug tracking-tight">
          “{quote.text}”
        </blockquote>
        {quote.author && <p className="mt-4 text-[15px] text-muted">— {quote.author}</p>}
      </div>
      <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-3">
        <button
          className={`${saved ? btn.primary : btn.soft} min-h-14 text-base`}
          aria-pressed={saved}
          onClick={() => {
            buzz(15);
            actions.toggleSaveQuote(quote.id);
          }}
        >
          {HEART(saved)} {saved ? "Saved" : "Save"}
        </button>
        <button
          className={`${btn.ghost} min-h-14 text-base`}
          onClick={() => {
            buzz(10);
            setQuote(actions.anotherQuote());
          }}
        >
          Another one
        </button>
      </div>
    </div>
  );
}

/** Menu → Quotes: the ones you saved. */
export function QuotesSheet({ onClose }: { onClose: () => void }) {
  const data = useData();
  const saved = (data ? quoteStateOf(data).saved : []).map((id) => quoteById(id)).filter((q): q is Quote => !!q);
  return (
    <Sheet title="Quotes" onClose={onClose}>
      {saved.length ? (
        <ul className="space-y-3">
          {[...saved].reverse().map((q) => (
            <li key={q.id} className="rounded-2xl bg-bg p-4">
              <p className="break-words text-[16px] leading-snug">“{q.text}”</p>
              {q.author && <p className="mt-1 text-sm text-muted">— {q.author}</p>}
              <button className="mt-2 min-h-10 text-sm font-medium text-muted" onClick={() => actions.toggleSaveQuote(q.id)}>
                ♥ Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm leading-relaxed text-muted">
          Nothing saved yet. When a quote makes you feel good, tap ♥ Save and it will live here.
        </p>
      )}
    </Sheet>
  );
}
