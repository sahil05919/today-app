/**
 * Hands text to the Android share sheet (WhatsApp, LinkedIn…), or copies it where there is none.
 *  "shared": the share sheet was used (the page cannot tell which app, or whether it was sent: it only knows the sheet closed normally)
 *  "copied": there is no share sheet here; the text is on the clipboard instead
 *  "cancelled": the sheet was closed without choosing anything
 *  "failed": neither worked
 */
export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareText(text: string, title?: string): Promise<ShareOutcome> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return "shared";
    }
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return "cancelled";
  }
  return (await copyText(text)) ? "copied" : "failed";
}
