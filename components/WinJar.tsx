"use client";
import { fmtMinutes } from "@/lib/other";
import { actions } from "@/lib/store";
import type { AppData } from "@/lib/types";
import { addDays, dayOfMonth, fromISO } from "@/lib/dates";
import { bestStreaks, biggestWeek, jarBetween, monthCompare, slowDay, tasksDone, winLine, type JarStats } from "@/lib/winjar";
import { btn, Sheet, type Panel, type ViewCtx } from "./ui";

/** A quiet card on a slow day (never a notification, once a day, dismissible): what you HAVE done lately. */
export function WinJarCard({ data, ctx, now, summary, openPanel }: { data: AppData; ctx: ViewCtx; now: Date; summary: { done: number; total: number }; openPanel: (p: Panel) => void }) {
  const slow = slowDay(data, now, summary);
  const line = slow ? winLine(data, ctx.today) : null;
  if (!slow || !line) return null;
  return (
    <div className="rounded-2xl bg-accent-soft p-3.5" role="note">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden="true">
          🏆
        </span>
        <p className="min-w-0 flex-1 text-[15px] font-medium leading-snug">{line}</p>
        <button onClick={() => actions.settings({ winJarDismissed: ctx.today })} aria-label="Dismiss" className="-mr-1 min-h-9 px-2 text-muted">
          ✕
        </button>
      </div>
      <button className={`${btn.soft} mt-2 min-h-10`} onClick={() => openPanel("winjar")}>
        See my win jar
      </button>
    </div>
  );
}

function Row({ label, a, b }: { label: string; a: string | number; b: string | number }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="py-1.5 pr-2 text-sm">{label}</td>
      <td className="py-1.5 text-right text-sm font-semibold tabular-nums">{a}</td>
      <td className="py-1.5 pl-3 text-right text-sm tabular-nums text-muted">{b}</td>
    </tr>
  );
}

const rowsOf = (s: JarStats, ctx: ViewCtx) => ({
  areas: ctx.profile.areas.filter((x) => x.target).map((x) => ({ id: x.id, label: `${x.emoji} ${x.name}`, n: s.sessions[x.id] ?? 0 })),
});

/** Menu → Win jar: this month against last month, your best streaks, your biggest week. */
export function WinJarSheet({ data, ctx, onClose }: { data: AppData; ctx: ViewCtx; onClose: () => void }) {
  const m = monthCompare(data, ctx.today);
  const streaks = bestStreaks(data, ctx.today);
  const big = biggestWeek(data, ctx.today);
  const last30 = jarBetween(data, addDays(ctx.today, -29), ctx.today);
  const rows = rowsOf(m.thisMonth, ctx).areas.map((r) => ({ ...r, was: m.lastMonth.sessions[r.id] ?? 0 }));
  const nothing = rows.every((r) => !r.n && !r.was) && !tasksDone(m.thisMonth) && !tasksDone(m.lastMonth);
  const week = big ? fromISO(big.week) : null;
  return (
    <Sheet title="Win jar" onClose={onClose}>
      <div className="space-y-5">
        <p className="-mt-1 text-sm text-muted">{winLine(data, ctx.today) ?? "Your wins collect here as you finish things."}</p>
        {nothing ? (
          <p className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">Nothing in the jar yet. Finish a session or a task and it lands here.</p>
        ) : (
          <>
            <section aria-label="This month against last month">
              <table className="w-full">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted">
                    <th className="text-left font-semibold">&nbsp;</th>
                    <th className="text-right font-semibold">{m.thisLabel}</th>
                    <th className="pl-3 text-right font-semibold">{m.lastLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Row key={r.id} label={r.label} a={r.n} b={r.was} />
                  ))}
                  <Row label="✅ Tasks done" a={tasksDone(m.thisMonth)} b={tasksDone(m.lastMonth)} />
                  <Row label="📧 …from Gmail" a={m.thisMonth.gmailTasks} b={m.lastMonth.gmailTasks} />
                  <Row label="🧺 Life admin" a={m.thisMonth.lifeAdmin} b={m.lastMonth.lifeAdmin} />
                  <Row label="⬆️ Pulled forward" a={m.thisMonth.pulled} b={m.lastMonth.pulled} />
                  <Row label="🧩 Other work" a={fmtMinutes(m.thisMonth.otherMinutes)} b={fmtMinutes(m.lastMonth.otherMinutes)} />
                </tbody>
              </table>
            </section>

            <section aria-label="Best streaks">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Best streaks</h3>
              <p className="text-sm">🔥 Any session: {streaks.overall} {streaks.overall === 1 ? "day" : "days"} in a row</p>
              <ul className="mt-1 text-sm text-muted">
                {ctx.profile.areas
                  .filter((a) => a.target && (streaks.byArea[a.id] ?? 0) > 1)
                  .map((a) => (
                    <li key={a.id}>
                      {a.emoji} {a.name}: {streaks.byArea[a.id]} days
                    </li>
                  ))}
              </ul>
            </section>

            {big && week && (
              <section aria-label="Biggest week" className="rounded-2xl bg-accent-soft p-3.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Biggest week</h3>
                <p className="mt-1 text-[15px] font-medium">
                  Week of {dayOfMonth(big.week)} {week.toLocaleDateString("en-GB", { month: "short" })}: {big.sessions} {big.sessions === 1 ? "session" : "sessions"} and {big.tasks} {big.tasks === 1 ? "task" : "tasks"} done
                  {big.otherMinutes ? `, ${fmtMinutes(big.otherMinutes)} of other work` : ""} 🎉
                </p>
              </section>
            )}
            <p className="text-xs text-muted">Last 30 days: {Object.values(last30.sessions).reduce((n, x) => n + x, 0)} sessions, {tasksDone(last30)} tasks done.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
