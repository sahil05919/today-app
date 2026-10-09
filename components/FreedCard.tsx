"use client";
import { useEffect, useState } from "react";
import { dayWord } from "@/lib/done";
import { behindAreas, offerIsLive, type FreedChoice } from "@/lib/freedom";
import { toHHMM } from "@/lib/profile";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { type ViewCtx } from "./ui";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Power BI done for the week 🎉, Sahil." Shown once when any area's weekly target is reached, with the time that just
 * came free offered once: Rest · Extra session · Something from Ideas · Another area that's behind.
 * The choice becomes an ordinary task in that slot, so the timeline places it by its usual rules. Rest leaves it empty.
 */
export function FreedCard({ data, ctx, now }: { data: AppData; ctx: ViewCtx; now: Date }) {
  const offer = data.settings.freed;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const live = offerIsLive(offer, ctx.today, nowMin);
  const [more, setMore] = useState<"idea" | "behind" | null>(null);

  // An offer for a week that has passed, or for a slot that is over, quietly goes away.
  useEffect(() => {
    if (offer && !live) actions.settings({ freed: undefined });
  }, [offer, live]);

  if (!offer || !live) return null;
  const area = ctx.profile.areas.find((a) => a.id === offer.areaId);
  if (!area) return null;
  const ideas = (data.bored ?? []).slice(0, 5);
  const behind = behindAreas(data, ctx.today, offer.areaId).slice(0, 4);

  const answer = (choice: FreedChoice) => {
    const t = actions.answerFreed(choice);
    if (t && offer.slot) ctx.notify(`Added “${t.title}” ${dayWord(offer.slot.date, ctx.today)} ${toHHMM(offer.slot.start)}`, () => actions.remove(t.id));
    else ctx.notify("Rest it is. Enjoy the time 🌿");
    setMore(null);
  };

  const chip = "min-h-11 rounded-full border border-line bg-surface px-3.5 text-sm font-medium";
  return (
    <section className="anim-fade rounded-2xl bg-accent-soft p-3.5" aria-label={`${area.name} is done for the week`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
          🎉 {area.name} done for the week, {ctx.profile.name || "friend"}.
        </p>
        <button onClick={() => actions.settings({ freed: undefined })} aria-label="Dismiss" className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted">
          ✕
        </button>
      </div>
      {offer.slot ? (
        <>
          <p className="mt-0.5 text-sm text-muted">
            {cap(dayWord(offer.slot.date, ctx.today))} {toHHMM(offer.slot.start)}–{toHHMM(offer.slot.end)} is now free:
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button className={chip} onClick={() => answer({ kind: "rest" })}>
              Rest
            </button>
            <button className={chip} onClick={() => answer({ kind: "extra" })}>
              Extra session
            </button>
            {ideas.length > 0 && (
              <button className={chip} aria-expanded={more === "idea"} onClick={() => setMore(more === "idea" ? null : "idea")}>
                From Ideas ▾
              </button>
            )}
            {behind.length > 0 && (
              <button className={chip} aria-expanded={more === "behind"} onClick={() => setMore(more === "behind" ? null : "behind")}>
                Another area ▾
              </button>
            )}
          </div>
          {more === "idea" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ideas.map((i) => (
                <button key={i.id} className={chip} onClick={() => answer({ kind: "idea", ideaId: i.id })}>
                  {i.text}
                </button>
              ))}
            </div>
          )}
          {more === "behind" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {behind.map((a) => (
                <button key={a.id} className={chip} onClick={() => answer({ kind: "behind", areaId: a.id })}>
                  {a.emoji} {a.name}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mt-0.5 text-sm text-muted">Nothing more planned for it this week. Extra sessions still count ⭐</p>
      )}
    </section>
  );
}
