"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiEnabled, transcribeAudio } from "@/lib/ai";
import { buzz } from "@/lib/haptics";
import { recorder } from "@/lib/nativeBridge";
import { parseCapture } from "@/lib/parse";
import { isNative } from "@/lib/platform";
import { getVoiceLang, saveVoiceLang, type VoiceLang } from "@/lib/speech";
import { startVoice, type VoiceSession } from "@/lib/voice";
import type { ISODate, Profile } from "@/lib/types";
import { MicIcon, StopIcon } from "./icons";
import { ParsePreview } from "./ParsePreview";
import { btn, field } from "./ui";

type Phase = "ready" | "listening" | "thinking" | "review";
type Engine = "gemini" | "device";

const MAX_RECORD_MS = 60_000;

/**
 * Speak a task. With a Gemini key (and a connection) the phone records you and Gemini writes down what you said, which
 * copes with Hinglish far better. Otherwise, or if that fails, Android's own recogniser listens (English India, patient with
 * pauses, showing words as you speak). Either way you see the words, editable, before anything is saved.
 */
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
  const [engine, setEngine] = useState<Engine>("device");
  const [phase, setPhase] = useState<Phase>("ready");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<VoiceSession | null>(null);
  const run = useRef(0); // ignores callbacks from a recording we already replaced
  const heard = useRef("");
  const recording = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout>>(undefined);

  const parsed = useMemo(() => (text.trim() ? parseCapture(text, new Date(), profile) : null), [text, profile]);

  // Which listener to use is decided each time you start: Gemini when it can work, the phone's own otherwise.
  const pickEngine = (): Engine => (isNative() && aiEnabled() && typeof navigator !== "undefined" && navigator.onLine ? "gemini" : "device");

  useEffect(() => {
    if (phase !== "listening" || engine !== "gemini") return;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase, engine]);

  const stopGemini = async (mine: number) => {
    if (!recording.current) return;
    recording.current = false;
    clearTimeout(limit.current);
    setPhase("thinking");
    try {
      const audio = await recorder.stop();
      if (run.current !== mine) return;
      const r = await transcribeAudio({ base64: audio.base64, mime: audio.mime });
      if (run.current !== mine) return;
      if (!r.ok) {
        setError(r.reason === "offline" ? "Couldn't reach Gemini. Try again, or use the phone's listener." : "Gemini couldn't read that. Try again, or use the phone's listener.");
        setPhase("ready");
      } else if (!r.text) {
        setError("I didn't catch anything. Tap the mic and try again.");
        setPhase("ready");
      } else {
        heard.current = r.text;
        setText(r.text);
        setPhase("review");
      }
    } catch {
      if (run.current === mine) {
        setError("The recording didn't work this time. Typing still works.");
        setPhase("ready");
      }
    }
  };

  const start = async (l: VoiceLang = lang, force?: Engine) => {
    rec.current?.abort();
    if (recording.current) {
      recording.current = false;
      void recorder.cancel();
    }
    const mine = ++run.current;
    setError("");
    setText("");
    heard.current = "";
    const which = force ?? pickEngine();
    setEngine(which);
    buzz(10);

    if (which === "gemini") {
      try {
        await recorder.start(MAX_RECORD_MS);
      } catch (e) {
        if (run.current !== mine) return;
        // No microphone permission or a phone that can't record: the phone's own listener may still work.
        void start(l, "device");
        void e;
        return;
      }
      if (run.current !== mine) return void recorder.cancel();
      recording.current = true;
      setPhase("listening");
      limit.current = setTimeout(() => void stopGemini(mine), MAX_RECORD_MS);
      return;
    }

    setPhase("listening");
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
    if (autoStart) void start(l);
    return () => {
      run.current++;
      clearTimeout(limit.current);
      rec.current?.abort();
      if (recording.current) {
        recording.current = false;
        void recorder.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickLang = (l: VoiceLang) => {
    setLang(l);
    saveVoiceLang(l);
    if (phase === "listening" && engine === "device") void start(l);
  };

  const onMic = () => {
    if (phase === "thinking") return;
    if (phase === "listening") {
      if (engine === "gemini") void stopGemini(run.current);
      else rec.current?.stop();
    } else void start();
  };

  return (
    <div className="anim-sheet mb-2 rounded-2xl border border-line bg-surface p-3.5 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        {engine === "device" ? (
          <div className="flex rounded-xl bg-bg p-1 text-sm font-medium" role="group" aria-label="Voice language">
            {(
              [
                ["en-IN", "English / Hinglish"],
                ["hi-IN", "हिन्दी"],
              ] as const
            ).map(([l, label]) => (
              <button key={l} onClick={() => pickLang(l)} aria-pressed={lang === l} className={`min-h-9 rounded-lg px-3 ${lang === l ? "bg-surface shadow-sm" : "text-muted"}`}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-sm font-medium text-accent">✨ Gemini is listening</span>
        )}
        <button
          onClick={() => {
            if (recording.current) void recorder.cancel();
            recording.current = false;
            onClose();
          }}
          className={btn.link}
        >
          Cancel
        </button>
      </div>

      {phase !== "review" ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={onMic}
            disabled={phase === "thinking"}
            aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-60 ${phase === "listening" ? "anim-pulse" : ""}`}
          >
            {phase === "listening" ? <StopIcon width={24} height={24} /> : <MicIcon width={24} height={24} />}
          </button>
          <div className="min-h-12 min-w-0 flex-1 text-[15px]" aria-live="polite">
            {error ? (
              <>
                <span className="text-warn">{error}</span>
                {engine === "gemini" && (
                  <button className="mt-1 block min-h-9 text-sm font-medium text-accent" onClick={() => void start(lang, "device")}>
                    Use the phone's listener
                  </button>
                )}
              </>
            ) : phase === "thinking" ? (
              <span className="text-muted">Understanding what you said…</span>
            ) : text ? (
              text
            ) : phase === "listening" ? (
              <span className="text-muted">
                {engine === "gemini" ? `Listening… ${seconds}s. Tap the square when you're done.` : "Listening… try “kal shaam 6 baje mummy ko call”"}
              </span>
            ) : (
              <span className="text-muted">Tap the mic and say your task.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <p className="text-xs text-muted">Is this what you said? Fix anything before saving.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Transcript" className={`${field} resize-none`} />
          {parsed && <ParsePreview parsed={parsed} today={today} defaultDate={defaultDate} areas={profile.areas} />}
          <div className="flex gap-2">
            <button className={`${btn.primary} min-h-11 flex-1`} disabled={!text.trim()} onClick={() => onSave(text)}>
              Save task
            </button>
            <button className={`${btn.ghost} min-h-11`} onClick={() => void start()}>
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
