"use client";
import { useMemo, useState } from "react";
import { allSources, allTicked, checklist, searchUrl, stateOf, thisWeeksFive, ticked, weeklySources, type Source } from "@/lib/sideWork";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { btn, field, Sheet, type ViewCtx } from "./ui";

/**
 * Side work: the Monday check. Every week, this week's 5, and all sources (searchable; star or hide each). A source opens a web
 * search for "<name> London jobs", so a link never goes stale. Ticking the whole check counts as the Monday task done.
 */
export function SideWorkSheet({ data, ctx, taskId, onClose }: { data: AppData; ctx: ViewCtx; taskId?: string; onClose: () => void }) {
  const today = ctx.today;
  const weekly = weeklySources(data);
  const five = thisWeeksFive(data, today);
  const list = checklist(data, today);
  const done = new Set(ticked(data, today));
  const count = list.filter((s) => done.has(s.id)).length;
  const st = stateOf(data);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");

  const everything = useMemo(() => allSources(data), [data]);
  const shown = everything.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [...new Set(shown.map((s) => s.groupName))];

  const finishIfAll = (nextTicked: Set<string>) => {
    if (!taskId) return;
    if (list.length > 0 && list.every((s) => nextTicked.has(s.id))) {
      actions.toggleDone(taskId);
      ctx.notify("Side work check done ✅");
    }
  };
  const tick = (s: Source) => {
    const on = !done.has(s.id);
    actions.sideWork.tick(today, s.id, on);
    if (on) finishIfAll(new Set([...done, s.id]));
  };

  const Row = ({ s, check }: { s: Source; check?: boolean }) => (
    <li className="flex min-h-12 items-center gap-2 border-b border-line py-1 last:border-b-0">
      {check && <input type="checkbox" checked={done.has(s.id)} onChange={() => tick(s)} aria-label={`${s.name} checked`} className="h-6 w-6 shrink-0 accent-[var(--accent)]" />}
      <a href={searchUrl(s.name)} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 py-2 text-[15px] ${check && done.has(s.id) ? "text-muted line-through" : ""}`}>
        {s.name} <span className="text-muted" aria-hidden="true">↗</span>
      </a>
      <button type="button" onClick={() => actions.sideWork.star(s.id)} aria-pressed={st.weekly.includes(s.id)} aria-label={st.weekly.includes(s.id) ? `Remove ${s.name} from every week` : `Check ${s.name} every week`} className="flex h-10 w-10 items-center justify-center text-lg">
        {st.weekly.includes(s.id) ? "★" : "☆"}
      </button>
      {!check && (
        <button type="button" onClick={() => actions.sideWork.hide(s.id)} aria-pressed={st.hidden.includes(s.id)} aria-label={st.hidden.includes(s.id) ? `Show ${s.name}` : `Hide ${s.name}`} className="flex h-10 w-10 items-center justify-center text-sm text-muted">
          {st.hidden.includes(s.id) ? "Show" : "Hide"}
        </button>
      )}
    </li>
  );

  return (
    <Sheet title="Side work check" onClose={onClose}>
      <p className="-mt-1 mb-3 text-sm text-muted">
        {count} of {list.length} checked this week. Each one opens a search for “name London jobs”.
      </p>

      <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted">Every week</h3>
      <ul>{weekly.map((s) => <Row key={s.id} s={s} check />)}</ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">This week&apos;s 5</h3>
      <ul>{five.filter((s) => !st.weekly.includes(s.id)).map((s) => <Row key={s.id} s={s} check />)}</ul>

      <details className="mt-4 rounded-2xl border border-line">
        <summary className="flex min-h-12 cursor-pointer items-center px-3 text-[15px] font-semibold">All sources · {everything.length}</summary>
        <div className="space-y-3 border-t border-line px-3 py-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sources" aria-label="Search sources" className={field} />
          {groups.map((g) => (
            <div key={g}>
              <h4 className="mb-1 text-xs font-semibold text-muted">{g}</h4>
              <ul>{shown.filter((s) => s.groupName === g).map((s) => <Row key={s.id} s={s} />)}</ul>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              actions.sideWork.add(name);
              setName("");
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add my own source" aria-label="Add my own source" className={field} />
            <button type="submit" className={`${btn.soft} min-h-11`} disabled={!name.trim()}>
              Add
            </button>
          </form>
        </div>
      </details>

      <button
        className={`${btn.primary} mt-4 min-h-12 w-full`}
        onClick={() => {
          if (taskId && !allTicked(data, today)) actions.toggleDone(taskId);
          else if (!taskId) ctx.notify("Open it from Monday's list to mark it done");
          onClose();
        }}
      >
        Done for this week
      </button>
    </Sheet>
  );
}
