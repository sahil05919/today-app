/**
 * Snap to Today's one setting, kept on this phone beside the Gemini key (never in the backup): "never send the picture itself".
 * Default off: the cleaned TEXT may go to Gemini; the picture only when the text was too weak to read, and never when it held
 * anything sensitive. Switched on, the picture never leaves the phone at all.
 */
const KEY = "today:snap-never-image";

export function getNeverSendImage(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setNeverSendImage(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the default (text only, picture when the text is weak) stands */
  }
}
