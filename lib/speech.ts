export type VoiceLang = "en-IN" | "hi-IN";

interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
export interface SpeechRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => SpeechRec;

export function getRecognitionCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG_KEY = "today:voice-lang";
export function getVoiceLang(): VoiceLang {
  try {
    return localStorage.getItem(LANG_KEY) === "hi-IN" ? "hi-IN" : "en-IN";
  } catch {
    return "en-IN";
  }
}
export function saveVoiceLang(l: VoiceLang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* ignore */
  }
}

export const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it in the site settings, or just type.",
  "service-not-allowed": "Voice typing isn't allowed on this device. Typing still works.",
  "no-speech": "I didn't catch anything. Tap the mic and try again.",
  "audio-capture": "I can't find a microphone.",
  network: "Voice needs an internet connection. Typing still works.",
  "language-not-supported": "That language isn't available for voice here.",
};
