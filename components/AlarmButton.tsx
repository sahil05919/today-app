"use client";
import { alarmKey, alarmOffer, alarmSetLine } from "@/lib/earlyAlarm";
import { setEarlyAlarm } from "@/lib/earlyAlarmRun";
import { isNative } from "@/lib/platform";
import { useData } from "@/lib/store";
import type { ISODate } from "@/lib/types";
import { btn, type ViewCtx } from "./ui";

/**
 * "Set alarm" for anything that starts before 08:00 (a 07:00 shift, an early event, a task you timed): a real Android alarm,
 * `wake-up lead` minutes before it (Settings). Android alarms have no date, so it is only offered within 24 hours of the alarm time.
 * Once set it reads "⏰ alarm set 05:30".
 */
export function AlarmButton({ ctx, itemKey, title, date, startMin }: { ctx: ViewCtx; itemKey: string; title: string; date: ISODate; startMin: number }) {
  const data = useData();
  if (!data) return null;
  const offer = alarmOffer(date, startMin, new Date(), ctx.profile.wakeLeadMin);
  if (offer.kind === "none" || offer.kind === "passed") return null;
  const key = alarmKey(itemKey, date);
  const set = data.settings.alarmsSet?.[key];
  if (set) return <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium">{alarmSetLine(set)}</p>;
  if (!isNative()) return null;
  if (offer.kind === "later") {
    return (
      <p className="rounded-xl bg-bg px-3 py-2 text-sm text-muted">
        ⏰ Alarm at {offer.time}. {offer.note}.
      </p>
    );
  }
  return (
    <button
      className={`${btn.soft} min-h-12 w-full`}
      onClick={async () => {
        const ok = await setEarlyAlarm({ hour: offer.hour, minutes: offer.minutes, message: title.slice(0, 80), key, time: offer.time });
        ctx.notify(ok ? `Alarm set for ${offer.time}` : "Couldn't set the alarm. Is a clock app installed?");
      }}
    >
      ⏰ Set alarm for {offer.time}
    </button>
  );
}
