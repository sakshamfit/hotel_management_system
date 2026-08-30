/**
 * Web Audio API — programmatic two-tone siren (no external audio file, no CDN).
 * Shared by the live order Alert Center and the Settings "Test Siren" button
 * so there is exactly one implementation of the sound.
 */

let audioCtx: AudioContext | null = null;

/** Shared AudioContext singleton — exported so callers can inspect .state. */
export function getAlertAudioContext(): AudioContext | null {
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

export function unlockAlertAudio(): boolean {
  const ctx = getAlertAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return true;
}

/** Two-tone siren sweep (~1.5s). Safe to call even if Web Audio is unsupported. */
export function playAlertSiren(): void {
  const ctx = getAlertAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    const now = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freqs = [880, 620, 880, 620, 880];
    const step = 0.3;
    freqs.forEach((freq, i) => {
      const t = now + i * step;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + step - 0.02);
    });

    osc.start(now);
    osc.stop(now + freqs.length * step + 0.1);
  } catch {
    // Audio is non-critical; never break the app
  }
}

/** Browser text-to-speech announcement — no external API. */
export function speakAlertText(text: string): void {
  if (typeof window === 'undefined') return;
  const synth = (window as any).speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;
    synth.speak(utter);
  } catch {
    // Voice is non-critical; never break the app
  }
}
