import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { isNative } from "./platform";
import { getRecognitionCtor, VOICE_ERRORS, type SpeechRec, type VoiceLang } from "./speech";

/**
 * One voice API for both worlds:
 *  - Android app: the native speech plugin (the Web Speech API doesn't work in a WebView).
 *    Works offline when the phone has the offline language pack for en-IN / hi-IN.
 *  - Chrome (web / PWA): the Web Speech API, which needs a connection.
 */
export interface VoiceSession {
  /** Stop listening and keep what was heard. */
  stop(): void;
  /** Stop and throw it away. */
  abort(): void;
}

export interface VoiceHandlers {
  onText(text: string): void;
  onError(message: string): void;
  onEnd(): void;
}

/** Quick, synchronous check used to decide whether to show the mic at all. */
export function voiceSupported(online: boolean): boolean {
  if (isNative()) return true; // availability is double-checked when listening starts
  return !!getRecognitionCtor() && online;
}

export async function startVoice(lang: VoiceLang, h: VoiceHandlers): Promise<VoiceSession | null> {
  return isNative() ? startNative(lang, h) : startWeb(lang, h);
}

function startWeb(lang: VoiceLang, h: VoiceHandlers): VoiceSession | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    h.onError(VOICE_ERRORS["service-not-allowed"]);
    return null;
  }
  const r: SpeechRec = new Ctor();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let s = "";
    for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript + " ";
    h.onText(s.trim());
  };
  r.onerror = (e) => {
    if (e.error !== "aborted") h.onError(VOICE_ERRORS[e.error] ?? "Voice didn't work this time. Typing still works.");
  };
  r.onend = () => h.onEnd();
  try {
    r.start();
  } catch {
    h.onError("Couldn't start the microphone. Typing still works.");
    return null;
  }
  return { stop: () => r.stop(), abort: () => r.abort() };
}

/**
 * Android's own recogniser, set up to be patient: it stops by itself after a short silence, so we start it again
 * (keeping what was heard) until you tap stop, it hears nothing twice, or about a minute has gone by. Partial results
 * show as you speak, and the language defaults to English (India), which also understands Hinglish well.
 */
const MAX_ROUNDS = 10;

async function startNative(lang: VoiceLang, h: VoiceHandlers): Promise<VoiceSession | null> {
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) {
      h.onError("This phone has no speech recogniser. Install or enable Google voice typing, or just type.");
      return null;
    }
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== "granted") {
      h.onError(VOICE_ERRORS["not-allowed"]);
      return null;
    }
    let committed = "";
    let current = "";
    let rounds = 0;
    let emptyRounds = 0;
    let stoppedByUser = false;
    let ended = false;

    const emit = () => h.onText(`${committed} ${current}`.trim());
    const finish = () => {
      if (ended) return;
      ended = true;
      SpeechRecognition.removeAllListeners().catch(() => {});
      h.onEnd();
    };
    const onRoundEnd = () => {
      if (ended) return;
      if (current) {
        committed = `${committed} ${current}`.trim();
        emptyRounds = 0;
      } else emptyRounds++;
      current = "";
      const quiet = emptyRounds >= 2 || (!committed && rounds >= 2);
      if (!stoppedByUser && !quiet && rounds < MAX_ROUNDS) void begin();
      else finish();
    };
    const begin = async () => {
      rounds++;
      try {
        await SpeechRecognition.removeAllListeners();
        await SpeechRecognition.addListener("partialResults", (d) => {
          if (d.matches?.[0]) {
            current = d.matches[0];
            emit();
          }
        });
        await SpeechRecognition.addListener("listeningState", (d) => {
          if (d.status === "stopped") onRoundEnd();
        });
        // partialResults:true → resolves right away; text arrives through the listener above.
        SpeechRecognition.start({ language: lang, maxResults: 3, partialResults: true, popup: false }).catch((e) => {
          h.onError(/offline|network/i.test(String(e)) ? VOICE_ERRORS.network : "Voice didn't work this time. Typing still works.");
          finish();
        });
      } catch {
        finish();
      }
    };
    await begin();
    return {
      stop: () => {
        stoppedByUser = true;
        void SpeechRecognition.stop().catch(() => finish());
      },
      abort: () => {
        ended = true;
        stoppedByUser = true;
        SpeechRecognition.removeAllListeners().catch(() => {});
        SpeechRecognition.stop().catch(() => {});
      },
    };
  } catch {
    h.onError("Couldn't start the microphone. Typing still works.");
    return null;
  }
}
