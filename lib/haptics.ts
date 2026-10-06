/** Short vibration where supported (Chrome Android). Silent no-op elsewhere. */
export function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
