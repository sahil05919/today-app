"use client";
import { btn, Sheet, type Panel } from "./ui";

/** Five things, nothing else. Backup and appearance live inside Settings. */
export function MenuSheet({ onClose, onPanel }: { onClose: () => void; onPanel: (p: Panel) => void }) {
  const items: Array<[Panel, string, string]> = [
    ["calendar", "📅", "Calendar"],
    ["shopping", "🛒", "Shopping list"],
    ["bills", "💳", "Bills & chores"],
    ["goals", "🎯", "Must-haves"],
  ];
  return (
    <Sheet title="Menu" onClose={onClose}>
      <div className="space-y-2">
        {items.map(([p, emoji, label]) => (
          <button key={p} className={`${btn.ghost} flex min-h-14 w-full items-center gap-3 text-left text-base`} onClick={() => onPanel(p)}>
            <span aria-hidden="true" className="text-xl">
              {emoji}
            </span>
            {label}
          </button>
        ))}
        <button className={`${btn.primary} flex min-h-14 w-full items-center gap-3 text-left text-base`} onClick={() => onPanel("me")}>
          <span aria-hidden="true" className="text-xl">
            ⚙️
          </span>
          Settings
        </button>
      </div>
      <p className="pb-1 pt-5 text-center text-xs text-muted">Sahil's Today · created by Sahil</p>
    </Sheet>
  );
}
