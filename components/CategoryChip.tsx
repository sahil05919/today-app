"use client";
import { useState } from "react";
import { categoryLabel, SUBS_OF_OTHER, OTHER } from "@/lib/categorise";
import { chipForEvent, chipForTask, chipForTL } from "@/lib/catUi";
import { closeCategoryPicker, openCategoryPicker, useCategoryPicker } from "@/lib/catPicker";
import type { ChipTarget } from "@/lib/catUi";
import { actions, useData } from "@/lib/store";
import type { FixedEvent, SubLabel, Task } from "@/lib/types";
import type { TLItem } from "@/lib/timeline";
import { btn, Sheet } from "./ui";

/**
 * The small category chip on every row and item sheet: "📊 Power BI", "📥 Other · Building". Tap to change it (and teach the app:
 * the next item with the same words goes there too). A low-confidence guess is drawn faintly, with a dashed edge, so you notice it.
 */
export function CategoryChip({ target }: { target: ChipTarget | null }) {
  const data = useData();
  if (!target || !data) return null;
  const label = categoryLabel(data, target.cat);
  const faint = target.cat.conf === "low";
  const cls = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${faint ? "border-dashed border-line text-muted/70" : "border-line bg-bg text-muted"}`;
  const text = (
    <>
      <span aria-hidden="true">{label.emoji}</span> {label.text}
      {faint ? " ?" : ""}
    </>
  );
  if (!target.editable) return <span className={cls}>{text}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Category: ${label.text}${faint ? " (a guess)" : ""}. Tap to change`}
      className={`${cls} cursor-pointer`}
      onClick={(e) => {
        e.stopPropagation();
        openCategoryPicker(target);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          openCategoryPicker(target);
        }
      }}
    >
      {text}
    </span>
  );
}

/** The one picker sheet. Mounted once in App. */
export function CategoryPickerHost({ notify }: { notify: (msg: string) => void }) {
  const target = useCategoryPicker();
  const data = useData();
  const [pickedOther, setPickedOther] = useState(false);
  if (!target || !data) return null;
  const areas = (data.profile?.areas ?? []).filter((a) => a.id !== OTHER);
  const cur = target.cat;
  const close = () => {
    setPickedOther(false);
    closeCategoryPicker();
  };
  const choose = (area: string, sub?: SubLabel) => {
    actions.setCategory({ key: target.key, title: target.title }, { area, sub });
    notify(`Filed under ${area === OTHER ? `Other · ${sub ?? "Other"}` : (areas.find((a) => a.id === area)?.name ?? area)}. I'll remember that.`);
    close();
  };
  const showSubs = pickedOther || cur.area === OTHER;
  return (
    <Sheet title="Category" onClose={close}>
      <p className="-mt-1 mb-3 text-sm text-muted">“{target.title}”. Pick where it belongs. Next time, things with the same words go there too.</p>
      <div className="grid grid-cols-2 gap-2">
        {areas.map((a) => (
          <button key={a.id} onClick={() => choose(a.id)} className={`${a.id === cur.area ? btn.primary : btn.ghost} min-h-12 text-left`}>
            {a.emoji} {a.name}
          </button>
        ))}
        <button onClick={() => setPickedOther(true)} className={`${cur.area === OTHER || pickedOther ? btn.primary : btn.ghost} min-h-12 text-left`}>
          📥 Other
        </button>
      </div>
      {showSubs && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">What kind of Other?</h3>
          <div className="flex flex-wrap gap-2">
            {SUBS_OF_OTHER.map((s) => (
              <button key={s} onClick={() => choose(OTHER, s)} className={`${cur.area === OTHER && cur.sub === s ? btn.primary : btn.ghost} min-h-11`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The chip for a task (or one day of a repeat). */
export function TaskChip({ task }: { task: Task }) {
  const data = useData();
  return data ? <CategoryChip target={chipForTask(data, task)} /> : null;
}

/** The chip for a row of Today's timeline. */
export function TLChip({ it }: { it: TLItem }) {
  const data = useData();
  return data ? <CategoryChip target={chipForTL(data, it)} /> : null;
}

/** The chip for a calendar event. */
export function EventChip({ event }: { event: FixedEvent }) {
  const data = useData();
  return data ? <CategoryChip target={chipForEvent(data, event)} /> : null;
}
