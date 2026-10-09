/** A soft three-note chime for "time's up" while the app is open. Browsers need a tap first, so audio unlocks on the first one. */
let ctx: AudioContext | null = null;

function unlock() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio: the vibration and the card still work */
  }
}

export function installChimeUnlock(): () => void {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function playChime() {
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime;
  [660, 880, 1175].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const s = t0 + i * 0.28;
    gain.gain.setValueAtTime(0.0001, s);
    gain.gain.exponentialRampToValueAtTime(0.3, s + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(s);
    osc.stop(s + 0.52);
  });
}
