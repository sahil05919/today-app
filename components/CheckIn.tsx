"use client";
import { useState } from "react";
import { addDays, friendlyDate } from "@/lib/dates";
import { stepProgress } from "@/lib/estimate";
import { actions } from "@/lib/store";
import type { CheckInStatus, ISODate, Task } from "@/lib/types";
import { btn, Chip, field, Sheet } from "./ui";

type Phase = "ask" | "behind" | "stuck";

export function CheckIn({
  tasks,
  today,
  onFinish,
}: {
  /** Tasks to ask about, snapshotted when the check-in opened. */
  tasks: Task[];
  today: ISODate;
  onFinish: () => void;
}) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>("ask");
  const [step, setStep] = useState("");
  const [pick, setPick] = useState("");
  const [tally, setTally] = useState({ done: 0 });

  const task = tasks[i];
  const finished = i >= tasks.length;

  const next = () => {
    setI((n) => n + 1);
    setPhase("ask");
    setStep("");
    setPick("");
  };
  const record = (status: CheckInStatus) => actions.recordCheckIn(task.id, status);

  const reschedule = (date: ISODate) => {
    actions.setDue(task.id, date, task.dueTime);
    if (task.focus && date !== today) actions.update(task.id, { focus: false });
    record("behind");
    next();
  };

  const body = () => {
    if (finished) {
      return (
        <div className="py-6 text-center">
          <div className="text-4xl">🌿</div>
          <p className="mt-3 text-lg font-semibold">All caught up</p>
          <p className="mt-1 text-sm text-muted">
            {tally.done > 0 ? `${tally.done} finished already. ` : ""}Thanks for checking in. Go gently today.
          </p>
          <button onClick={onFinish} className={`${btn.primary} mt-6 w-full`}>
            On to today
          </button>
        </div>
      );
    }
    const prog = stepProgress(task);
    return (
      <div>
        <p className="text-xs font-medium text-muted">
          {i + 1} of {tasks.length}
        </p>
        <div className="mt-2 rounded-2xl bg-bg p-4">
          <p className="text-lg font-semibold leading-snug">{task.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.due && <Chip tone={task.due < today ? "warn" : "plain"}>{friendlyDate(task.due, today)}</Chip>}
            {prog.total > 0 && (
              <Chip>
                {prog.done}/{prog.total} steps
              </Chip>
            )}
          </div>
        </div>

        {phase === "ask" && (
          <>
            <p className="mb-3 mt-5 text-[15px]">How's this one going?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={btn.primary}
                onClick={() => {
                  if (task.status === "open") actions.toggleDone(task.id);
                  record("on-track");
                  setTally((t) => ({ done: t.done + 1 }));
                  next();
                }}
              >
                ✓ Done
              </button>
              <button
                className={btn.soft}
                onClick={() => {
                  record("on-track");
                  next();
                }}
              >
                On track
              </button>
              <button className={btn.ghost} onClick={() => setPhase("behind")}>
                A bit behind
              </button>
              <button className={btn.ghost} onClick={() => setPhase("stuck")}>
                Stuck
              </button>
            </div>
          </>
        )}

        {phase === "behind" && (
          <>
            <p className="mb-3 mt-5 text-[15px]">No worries, things slip. Want to give it a new date?</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Tomorrow", addDays(today, 1)],
                ["In 3 days", addDays(today, 3)],
                ["Next week", addDays(today, 7)],
              ].map(([label, d]) => (
                <button key={label} className={btn.soft} onClick={() => reschedule(d)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input type="date" value={pick} min={today} onChange={(e) => setPick(e.target.value)} className={field} aria-label="Pick a date" />
              <button className={btn.primary} disabled={!pick} onClick={() => reschedule(pick)}>
                Set
              </button>
            </div>
            <button
              className={`${btn.link} mt-3`}
              onClick={() => {
                record("behind");
                next();
              }}
            >
              Keep the date as it is
            </button>
          </>
        )}

        {phase === "stuck" && (
          <>
            <p className="mb-1 mt-5 text-[15px]">That's okay. It happens to everyone.</p>
            <p className="mb-3 text-sm text-muted">What's one small next step? Tiny is good, even “open the document”.</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const title = step.trim();
                if (!title) return;
                actions.addStep(task.id, title, undefined, true);
                record("stuck");
                next();
              }}
            >
              <input autoFocus value={step} onChange={(e) => setStep(e.target.value)} placeholder="One small step…" className={field} />
              <button type="submit" disabled={!step.trim()} className={btn.primary}>
                Save
              </button>
            </form>
            <button
              className={`${btn.link} mt-3`}
              onClick={() => {
                record("stuck");
                next();
              }}
            >
              Not sure yet, skip
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <Sheet title="Quick check-in" onClose={onFinish}>
      {!finished && i === 0 && phase === "ask" && (
        <p className="-mt-1 mb-3 text-sm text-muted">A friendly look at what's coming up. No pressure.</p>
      )}
      {body()}
      {!finished && (
        <button onClick={onFinish} className={`${btn.link} mt-6 block w-full text-center`}>
          Skip for today
        </button>
      )}
    </Sheet>
  );
}
