import { aiEnabled } from "../ai";
import { snapJpeg, snapRead, snapRelease } from "../nativeBridge";
import { askGemini } from "./gemini";
import type { SnapDeps } from "./run";
import { getNeverSendImage } from "./settings";

/** The real thing: the phone reads the pictures, Gemini (if a key is set and there is a network) improves them. */
export function nativeDeps(): SnapDeps {
  return {
    readImage: (uri) => snapRead(uri),
    getJpeg: snapJpeg,
    release: snapRelease,
    ask: (input) => askGemini(input),
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    aiOn: aiEnabled,
    neverImage: getNeverSendImage,
    now: () => new Date(),
  };
}
