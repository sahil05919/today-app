import { logError } from "./debugLog";

/** Every call into the phone gets this long. A call that never answers must not leave the screen waiting. */
export const NATIVE_TIMEOUT_MS = 5000;

export class NativeTimeout extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not answer in ${Math.round(ms / 1000)} s`);
    this.name = "NativeTimeout";
  }
}

/** Rejects if `p` has not settled in `ms`. (The call itself cannot be cancelled; its late answer is simply ignored.) */
export function withTimeout<T>(p: PromiseLike<T>, label: string, ms: number = NATIVE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new NativeTimeout(label, ms)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/**
 * Runs a native call with a 5 s timeout. On a hang or a rejection the error is logged (Settings → Health → Recent errors) and
 * `fallback` is returned, so the caller just carries on.
 */
export async function safely<T>(label: string, run: () => PromiseLike<T>, fallback: T, ms: number = NATIVE_TIMEOUT_MS): Promise<T> {
  try {
    return await withTimeout(run(), label, ms);
  } catch (e) {
    logError(`native:${label}`, e);
    return fallback;
  }
}
