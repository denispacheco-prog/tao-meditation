// Synthesized sounds (Web Audio API): a singing-bowl style bell
// and very soft cues for inhale/exhale. No audio files needed.

let ctx = null;
let master = null;

export function initAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) { if (master) master.gain.value = v; }
export const getAudio = () => (ctx ? { ctx, master } : null);

// Inharmonic partials give a bowl-like timbre.
export function bell(base = 196) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const partials = [
    [1, 0.5, 7], [2.71, 0.22, 4.5], [5.15, 0.10, 2.5], [8.5, 0.04, 1.2]
  ];
  for (const [ratio, amp, decay] of partials) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = base * ratio;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + decay + 0.1);
  }
}

// Soft swell lasting the whole phase: rising pitch on inhale, falling on exhale.
export function breathCue(kind, seconds) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  o.type = 'triangle';
  const [f0, f1] = kind === 'inhale' ? [130, 165] : [165, 130];
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f1, t + seconds);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06, t + Math.min(1.2, seconds / 3));
  g.gain.linearRampToValueAtTime(0, t + seconds - 0.2);
  o.connect(lp).connect(g).connect(master);
  o.start(t);
  o.stop(t + seconds);
}
