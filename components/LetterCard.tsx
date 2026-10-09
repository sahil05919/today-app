"use client";
import { useEffect } from "react";
import { aiEnabled } from "@/lib/ai";
import { ensureLetter } from "@/lib/coachRun";
import { letterFor } from "@/lib/letters";
import { weekStart } from "@/lib/stats";
import type { AppData, ISODate } from "@/lib/types";

/** "Your week in a letter": shown at the top of the weekly review. Written once a week (rules, or Gemini when there's a key). */
export function LetterCard({ data, today }: { data: AppData; today: ISODate }) {
  const letter = letterFor(data.letters, weekStart(today));
  useEffect(() => {
    void ensureLetter();
  }, []);

  if (!letter) {
    return aiEnabled() ? (
      <section aria-label="Your week in a letter" className="rounded-2xl bg-accent-soft p-4">
        <p className="text-sm text-muted">Writing your letter…</p>
      </section>
    ) : null;
  }
  return (
    <section aria-label="Your week in a letter" className="rounded-2xl bg-accent-soft p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">Your week in a letter</h3>
      <div className="space-y-2.5 text-[15px] leading-relaxed">
        {letter.text.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="whitespace-pre-line break-words">
            {para}
          </p>
        ))}
      </div>
    </section>
  );
}
