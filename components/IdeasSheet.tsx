"use client";
import { useState } from "react";
import type { AppData } from "@/lib/types";
import { EventsBody } from "./EventsSheet";
import { BoredBody } from "./ListSheets";
import { Sheet, type ViewCtx } from "./ui";

/** Free time ideas: things to do from your own list, and London events. (Getting bored + London events, in one place.) */
export function IdeasSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const [tab, setTab] = useState<"ideas" | "events">("ideas");
  return (
    <Sheet title="Free time ideas" onClose={onClose}>
      <div className="mb-4 flex rounded-xl bg-bg p-1 text-sm font-medium" role="tablist" aria-label="Free time ideas">
        {(
          [
            ["ideas", "🎲 Pick for me"],
            ["events", "🎟️ London events"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 flex-1 rounded-lg ${tab === k ? "bg-surface shadow-sm" : "text-muted"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "ideas" ? <BoredBody data={data} ctx={ctx} onClose={onClose} /> : <EventsBody data={data} ctx={ctx} />}
    </Sheet>
  );
}
