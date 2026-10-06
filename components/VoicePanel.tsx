"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { buzz } from "@/lib/haptics";
import { parseCapture } from "@/lib/parse";
import { getVoiceLang, saveVoiceLang, type VoiceLang } from "@/lib/speech";
import { startVoice, type VoiceSession } from "@/lib/voice";
import type { ISODate, Profile } from "@/lib/types";
import { MicIcon, StopIcon } from "./icons";
import { ParsePreview } from "./ParsePreview";
import { btn, field } from "./ui";

type Phase = "ready" | "listening" | "review";

/** Speak a task: live transcript, then edit-and-confirm before anything is saved. */
export function VoicePanel({
  today,
  profile,
  defaultDate,
  autoStart,
  onSave,
  onEdit,
  onClose,
}: {
  today: ISODate;
  profile: Profile;
  defaultDate?: ISODate;
  autoStart?: boolean;
  onSave: (text: string) => void;
  /** Move the transcript into the normal text box instead. */
  onEdit: (text: string) => void;
  onClose: () => void;
}) {
  const [lang, setLang] = useState<VoiceLang>("en-IN");
  const [phase, setPhase] = useState<Phase>("ready");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<VoiceSession | null>(null);
  const run = useRef(0); // ignores callbacks from a recording we already replaced
  const heard = useRef("");

  const parsed = useMemo(() => (text.trim() ? parseCapture(text, new Date(), profile) : null), [text, profile]);

  const start = async (l: VoiceLang = lang) => {
    rec.current?.abort();
    const mine = ++run.current;
    setError("");
    setText("");
    heard.current = "";
    setPhase("listening");
    buzz(10);
    const session = await startVoice(l, {
      onText: (t) => {
        if (run.current !== mine) return;
        heard.current = t;
        setText(t);
      },
      onError: (m) => run.current === mine && setError(m),
      onEnd: () => {
        if (run.current !== mine) return;
        rec.current = null;
        setPhase(heard.current ? "review" : "ready");
      },
    });
    if (run.current !== mine) return session?.abort();
    rec.current = session;
    if (!session) setPhase("ready");
  };

  useEffect(() => {
    const l = getVoiceLang();
    setLang(l);
    if (autoStart) start(l);
    return () => {
      run.current++;
      rec.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickLang = (l: VoiceLang) => {
    setLang(l);
    saveVoiceLang(l);
    if (phase === "listening") start(l);
  };

  return (
    <div className="anim-sheet mb-2 rounded-2xl border border-line bg-surface p-3.5 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="group" aria-label="Voice language">
          {(
            [
              ["en-IN", "English / Hinglish"],
              ["hi-IN", "हिन्दी"],
            ] as const
          ).map(([l, label]) => (
            <button
              key={l}
              onClick={() => pickLang(l)}
              aria-pressed={lang === l}
              className={`min-h-9 rounded-lg px-3 ${lang === l ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className={btn.link}>
          Cancel
        </button>
      </div>

      {phase !== "review" ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => (phase === "listening" ? rec.current?.stop() : start())}
            aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink ${phase === "listening" ? "anim-pulse" : ""}`}
          >
            {phase === "listening" ? <StopIcon width={24} height={24} /> : <MicIcon width={24} height={24} />}
          </button>
          <div className="min-h-12 min-w-0 flex-1 text-[15px]" aria-live="polite">
            {error ? (
              <span className="text-warn">{error}</span>
            ) : text ? (
              text
            ) : phase === "listening" ? (
              <span className="text-muted">Listening… try “kal shaam 6 baje mummy ko call”</span>
            ) : (
              <span className="text-muted">Tap the mic and say your task.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            aria-label="Transcript"
            className={`${field} resize-none`}
          />
          {parsed && <ParsePreview parsed={parsed} today={today} defaultDate={defaultDate} areas={profile.areas} />}
          <div className="flex gap-2">
            <button className={`${btn.primary} min-h-11 flex-1`} disabled={!text.trim()} onClick={() => onSave(text)}>
              Save task
            </button>
            <button className={`${btn.ghost} min-h-11`} onClick={() => start()}>
              Redo
            </button>
            <button className={`${btn.ghost} min-h-11`} onClick={() => onEdit(text)}>
              Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
