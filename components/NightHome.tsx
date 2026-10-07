"use client";
import { toHHMM } from "@/lib/profile";
import type { TLItem } from "@/lib/timeline";

/**
 * After your bedtime (23:00 unless you changed it) Today stops showing the day and just says goodnight, with the first
 * thing tomorrow so you can let go of it. The input box is still there if something pops into your head.
 */
export function NightHome({ first, isTomorrow, onPeek }: { first: TLItem | null; isTomorrow: boolean; onPeek: () => void }) {
  return (
    <section className="px-2 pt-10 text-center" aria-label="Time to sleep">
      <div className="text-5xl" aria-hidden="true">
        🌙
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">Time to sleep.</h2>
      <p className="mt-3 text-sm text-muted">{isTomorrow ? "Tomorrow starts with:" : "Your day starts with:"}</p>
      <p className="mt-1 text-xl font-semibold leading-snug">
        {first ? (
          <>
            {first.emoji && <span className="mr-1.5">{first.emoji}</span>}
            {first.title}
            {!first.allDay && <span className="ml-1.5 text-base font-normal text-muted">· {toHHMM(first.start)}</span>}
          </>
        ) : (
          "nothing yet. A gentle start."
        )}
      </p>
      <p className="mt-6 text-xs text-muted">Anything on your mind? Jot it below and let it go.</p>
      <button onClick={onPeek} className="mt-6 min-h-11 px-4 text-sm text-muted underline-offset-2 hover:underline">
        Peek at today
      </button>
    </section>
  );
}
