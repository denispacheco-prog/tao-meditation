// Background sound, synthesized on the device (Web Audio API): no files, no licences.
//   nature: follows the scene: water → waves, wind → wind, grass → meadow crickets,
//           rain / light → soft rain, sand → a small stream
//   music:  kalimba, flute, bowls, pads or piano; "vary" picks a different one each time
// Sounds are scheduled a few seconds ahead by a small loop.

import { getAudio } from './audio.js';

const LOOKAHEAD = 12;      // seconds of sound planned in advance
const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

let A = null;              // { ctx, master }
let bus = null;            // everything goes through here (volume, duck, pause)
let gens = [];             // generators: { next, make(t) -> seconds until next }
let loops = [];            // looping sources to stop at the end
let timer = null;
let level = 0.5, ducked = false, paused = false;
const buffers = {};

// ---------- public ----------
// Returns the music style actually played (useful when it was 'vary').
export function startAmbience({ ambience = 'none', scene = 'water', ambienceVolume = 0.5, music = 'vary' }) {
  stopAmbience(0);
  if (ambience === 'none') return;
  A = getAudio();
  if (!A) return;
  level = ambienceVolume; ducked = false; paused = false;
  const { ctx } = A;
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(A.master);
  if (ambience === 'nature' || ambience === 'both') startNature(scene);
  let style = null;
  if (ambience === 'music' || ambience === 'both') style = startMusic(music);
  for (const g of gens) g.next = ctx.currentTime + 0.1;
  plan();
  timer = setInterval(plan, 1000);
  apply(6);
  return style;
}

export function stopAmbience(fade = 4) {
  clearInterval(timer); timer = null;
  gens = [];
  if (!bus) return;
  const oldBus = bus, oldLoops = loops, t = A.ctx.currentTime;
  bus = null; loops = [];
  oldBus.gain.cancelScheduledValues(t);
  oldBus.gain.setValueAtTime(oldBus.gain.value, t);
  oldBus.gain.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => {
    oldLoops.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } });
    oldBus.disconnect();
  }, fade * 1000 + 200);
}

export function setAmbienceVolume(v) { level = v; apply(0.3); }
export function duck(on) { if (ducked !== on) { ducked = on; apply(1.2); } }
export function pauseAmbience(on) { paused = on; apply(on ? 1.5 : 3); }

function apply(seconds) {
  if (!bus) return;
  const t = A.ctx.currentTime;
  const v = paused ? 0 : level * 0.8 * (ducked ? 0.5 : 1);
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(v, t + seconds);
}

function plan() {
  if (!bus) return;
  const horizon = A.ctx.currentTime + LOOKAHEAD;
  for (const g of gens) {
    while (g.next < horizon) g.next += g.make(g.next);
  }
}

// ---------- building blocks ----------
function noise(kind) {
  const s = A.ctx.createBufferSource();
  s.buffer = noiseBuffer(kind);
  s.loop = true;
  s.start(0, rand(0, 5));
  loops.push(s);
  return s;
}

function noiseBuffer(kind) {
  const { ctx } = A;
  const key = kind + ctx.sampleRate;
  if (!buffers[key]) {
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      } else {                                   // brown
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    buffers[key] = buf;
  }
  return buffers[key];
}

function filter(type, freq, Q = 0.7) {
  const f = A.ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = Q;
  return f;
}

function gain(v) { const g = A.ctx.createGain(); g.gain.value = v; return g; }

function panner(p) {
  const { ctx } = A;
  if (!ctx.createStereoPanner) return gain(1);
  const n = ctx.createStereoPanner(); n.pan.value = p; return n;
}

function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

// ---------- nature ----------
function startNature(scene) {
  const out = gain(0.55);
  out.connect(bus);
  if (scene === 'wind') wind(out, 1);
  else if (scene === 'grass') { wind(out, 0.35); crickets(out); }
  else if (scene === 'rain' || scene === 'light') rain(out);
  else if (scene === 'sand') stream(out);
  else waves(out);
}

function waves(out) {
  const body = filter('lowpass', 500, 0.3);
  const bodyGain = gain(0.2);
  chain(noise('brown'), body, bodyGain, out);
  const foam = filter('bandpass', 2200, 0.4);
  const foamGain = gain(0);
  chain(noise('pink'), foam, foamGain, out);
  gens.push({ next: 0, make(t) {
    const dur = rand(7, 12), peak = t + dur * rand(0.35, 0.5);
    bodyGain.gain.setValueAtTime(0.2, t);
    bodyGain.gain.linearRampToValueAtTime(rand(0.7, 1), peak);
    bodyGain.gain.linearRampToValueAtTime(0.2, t + dur);
    body.frequency.setValueAtTime(450, t);
    body.frequency.linearRampToValueAtTime(rand(900, 1300), peak);
    body.frequency.linearRampToValueAtTime(450, t + dur);
    foamGain.gain.setValueAtTime(0, t);
    foamGain.gain.linearRampToValueAtTime(rand(0.05, 0.12), peak + 0.6);
    foamGain.gain.linearRampToValueAtTime(0, t + dur);
    return dur;
  } });
}

function wind(out, amount) {
  const band = filter('bandpass', 500, 0.8);
  const bandGain = gain(0.4 * amount);
  chain(noise('pink'), band, bandGain, out);
  const rumble = filter('lowpass', 180, 0.5);
  const rumbleGain = gain(0.35 * amount);
  chain(noise('brown'), rumble, rumbleGain, out);
  gens.push({ next: 0, make(t) {
    const dur = rand(4, 9);
    band.frequency.linearRampToValueAtTime(rand(280, 900), t + dur);
    bandGain.gain.linearRampToValueAtTime(rand(0.25, 1) * amount, t + dur);
    return dur;
  } });
}

function crickets(out) {
  const { ctx } = A;
  const voices = [{ f: rand(4200, 4500), pan: -0.5 }, { f: rand(4500, 4800), pan: 0.45 }];
  for (const v of voices) {
    const p = panner(v.pan);
    p.connect(out);
    let rest = 0;
    gens.push({ next: 0, make(t) {
      if (rest > 0) { rest--; return rand(0.8, 1.6); }
      if (Math.random() < 0.06) rest = Math.floor(rand(4, 10));   // falls silent for a while
      const pulses = Math.random() < 0.5 ? 3 : 4;
      for (let k = 0; k < pulses; k++) {
        const s = t + k * 0.05;
        const o = ctx.createOscillator();
        const g = gain(0);
        o.frequency.value = v.f;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.012, s + 0.008);
        g.gain.linearRampToValueAtTime(0, s + 0.03);
        chain(o, g, p);
        o.start(s); o.stop(s + 0.04);
      }
      return rand(0.7, 1.4);
    } });
  }
}

function stream(out) {
  const { ctx } = A;
  // the rush of water: band-limited noise whose level flickers quickly
  const rush = filter('bandpass', 1800, 0.9);
  const rushGain = gain(0.3);
  chain(noise('white'), rush, rushGain, out);
  chain(noise('brown'), filter('lowpass', 350, 0.5), gain(0.3), out);
  gens.push({ next: 0, make(t) {
    const dur = rand(0.08, 0.25);
    rushGain.gain.linearRampToValueAtTime(rand(0.15, 0.4), t + dur);
    rush.frequency.linearRampToValueAtTime(rand(1300, 2600), t + dur);
    return dur;
  } });
  gens.push({ next: 0, make(t) {                 // little bubbles
    const o = ctx.createOscillator();
    const g = gain(0);
    const p = panner(rand(-0.6, 0.6));
    const f = rand(350, 900);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.6, 2.4), t + 0.07);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.01, 0.025), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    chain(o, g, p, out);
    o.start(t); o.stop(t + 0.1);
    return rand(0.08, 0.5);
  } });
}

function rain(out) {
  const { ctx } = A;
  const hiss = chain(noise('pink'), filter('highpass', 700), filter('lowpass', 5500));
  const hissGain = gain(0.35);
  hiss.connect(hissGain).connect(out);
  gens.push({ next: 0, make(t) {
    const dur = rand(2, 5);
    hissGain.gain.linearRampToValueAtTime(rand(0.25, 0.45), t + dur);
    return dur;
  } });
  gens.push({ next: 0, make(t) {                 // a few distinct drops
    const o = ctx.createOscillator();
    const g = gain(0);
    const p = panner(rand(-0.8, 0.8));
    const f = rand(1400, 3200);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.05);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.01, 0.03), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    chain(o, g, p, out);
    o.start(t); o.stop(t + 0.08);
    return rand(0.12, 0.6);
  } });
}

// ---------- music ----------
// Five styles; "vary" picks one at random (never the same twice in a row).
export const MUSIC_STYLES = ['kalimba', 'flute', 'bowls', 'pads', 'piano'];
let lastStyle = null;

function resolveStyle(style) {
  if (MUSIC_STYLES.includes(style)) return style;
  return pick(MUSIC_STYLES.filter(s => s !== lastStyle));
}

const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

function reverb(seconds = 4) {
  const { ctx } = A;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function startMusic(style) {
  const chosen = resolveStyle(style);
  lastStyle = chosen;
  const music = gain(0.6);
  const dry = gain(0.55), wet = gain(chosen === 'bowls' ? 0.6 : 0.85);
  music.connect(dry).connect(bus);
  music.connect(reverb(chosen === 'pads' ? 5 : 4)).connect(wet).connect(bus);
  ({ kalimba, flute, bowls, pads, piano })[chosen](music);
  return chosen;
}

// A held tone that fades in and out (used for pads).
function tone(out, f, t, { type = 'sine', level = 0.03, attack = 6, hold = 10, release = 8, cutoff = 900, detune = 0 }) {
  const { ctx } = A;
  const o = ctx.createOscillator();
  const lp = filter('lowpass', cutoff, 0.5);
  const g = gain(0);
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setValueAtTime(level, t + attack + hold);
  g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
  chain(o, lp, g, out);
  o.start(t); o.stop(t + attack + hold + release + 0.2);
}

function drone(out, freqs, level = 0.05, cutoff = 650) {
  const { ctx } = A;
  const lp = filter('lowpass', cutoff, 0.5);
  const g = gain(level);
  lp.connect(g).connect(out);
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = i === 1 ? 'triangle' : 'sine';
    o.frequency.value = f; o.detune.value = [0, 4, -3, 2][i % 4];
    o.connect(lp); o.start(); loops.push(o);
  });
}

// --- kalimba: drone on G, slow pad notes, sparse tines on G major pentatonic
function kalimba(out) {
  const SCALE = [392, 440, 493.88, 587.33, 659.25, 783.99, 880, 987.77, 1174.66];
  const PAD = [98, 110, 123.47, 146.83, 164.81];
  drone(out, [98, 98, 146.83]);
  gens.push({ next: 0, make(t) {
    const dur = rand(16, 26);
    tone(out, pick(PAD) * 2, t, { type: 'triangle', level: 0.025, hold: dur - 6 });
    return dur;
  } });
  let idx = 3;
  gens.push({ next: 0, make(t) {
    if (Math.random() < 0.15) return rand(6, 11);
    idx = Math.max(0, Math.min(SCALE.length - 1, idx + pick([-2, -1, -1, 1, 1, 2])));
    tine(SCALE[idx], t, out);
    if (Math.random() < 0.2 && idx >= 2) tine(SCALE[idx - 2], t + rand(0.05, 0.4), out, 0.6);
    return rand(2.5, 6.5);
  } });
}

function tine(f, t, out, strength = 1) {
  const { ctx } = A;
  const g = gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06 * strength, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
  g.connect(out);
  for (const [ratio, amp, decay] of [[1, 1, 3.5], [4.02, 0.12, 0.6]]) {
    const o = ctx.createOscillator();
    const og = gain(amp);
    o.frequency.value = f * ratio;
    og.gain.setValueAtTime(amp, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    chain(o, og, g);
    o.start(t); o.stop(t + decay + 0.1);
  }
}

// --- flute: breathy, bending phrases in D minor pentatonic over a faint D drone
function flute(out) {
  const SCALE = [62, 65, 67, 69, 72, 74, 77].map(hz);    // D4 F4 G4 A4 C5 D5 F5
  drone(out, [73.42, 110, 146.83], 0.03, 500);
  let idx = 2;
  gens.push({ next: 0, make(t) {
    const notes = Math.floor(rand(2, 5));
    let at = t;
    for (let k = 0; k < notes; k++) {
      idx = Math.max(0, Math.min(SCALE.length - 1, idx + pick([-2, -1, -1, 0, 1, 1, 2])));
      const len = k === notes - 1 ? rand(3.5, 6) : rand(1.6, 3.2);
      blow(SCALE[idx], at, len, out);
      at += len + rand(0.15, 0.5);
    }
    return at - t + rand(5, 11);                       // rest between phrases
  } });
}

function blow(f, t, len, out) {
  const { ctx } = A;
  const g = gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.045, t + 0.35);
  g.gain.setValueAtTime(0.045, t + len * 0.7);
  g.gain.linearRampToValueAtTime(0, t + len);
  const lp = filter('lowpass', f * 3, 0.6);
  chain(lp, g, out);
  // body: slight scoop up to pitch, vibrato growing after a second
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f * 0.975, t);
  o.frequency.linearRampToValueAtTime(f, t + 0.3);
  const vib = ctx.createOscillator(), vibDepth = gain(0);
  vib.frequency.value = 4.8;
  vibDepth.gain.setValueAtTime(0, t);
  vibDepth.gain.linearRampToValueAtTime(0, t + Math.min(1, len * 0.4));
  vibDepth.gain.linearRampToValueAtTime(f * 0.006, t + len);
  vib.connect(vibDepth).connect(o.frequency);
  const o2 = ctx.createOscillator(), o2g = gain(0.18);
  o2.frequency.value = f * 2;
  o.connect(lp); o2.connect(o2g).connect(lp);
  // breath noise around the note
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer('white');
  const bp = filter('bandpass', f * 2, 2.5), ng = gain(0.5);
  chain(n, bp, ng, lp);
  for (const x of [o, o2, vib, n]) { x.start(t); x.stop(t + len + 0.1); }
}

// --- bowls: singing bowls of different sizes, long and overlapping
function bowls(out) {
  const BOWLS = [130.81, 196, 220, 261.63, 293.66, 392];  // C3 G3 A3 C4 D4 G4
  gens.push({ next: 0, make(t) {
    bowl(pick(BOWLS), t, out, rand(0.6, 1));
    if (Math.random() < 0.25) bowl(pick(BOWLS), t + rand(1.5, 4), out, rand(0.4, 0.7));
    return rand(7, 14);
  } });
}

function bowl(f, t, out, strength) {
  const { ctx } = A;
  const p = panner(rand(-0.5, 0.5));
  p.connect(out);
  for (const [ratio, amp, decay, beat] of [[1, 0.5, 12, 0.7], [2.71, 0.2, 8, 1.3], [5.15, 0.07, 4, 2.1]]) {
    for (const d of [0, beat]) {                        // two close partials give the slow "wah" beating
      const o = ctx.createOscillator();
      const g = gain(0);
      o.frequency.value = f * ratio + d;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * 0.05 * strength, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      chain(o, g, p);
      o.start(t); o.stop(t + decay + 0.1);
    }
  }
}

// --- pads: slow, warm chords that dissolve into each other (no melody)
function pads(out) {
  const CHORDS = [
    [38, 45, 52, 54, 61],     // Dmaj9
    [35, 42, 50, 52, 57],     // Bm11
    [31, 38, 50, 54, 61],     // Gmaj7#11
    [33, 40, 49, 52, 59],     // A6/9
    [40, 47, 50, 54, 59]      // Em9
  ];
  let i = 0;
  gens.push({ next: 0, make(t) {
    const dur = rand(18, 26);
    i = (i + pick([1, 1, 2, 3])) % CHORDS.length;
    CHORDS[i].forEach((m, k) => {
      for (const det of [-6, 6]) {
        tone(out, hz(m), t + k * 0.4, {
          type: k === 0 ? 'sine' : 'triangle', level: k === 0 ? 0.022 : 0.012,
          attack: 7, hold: dur - 7, release: 9, cutoff: 700 + k * 120, detune: det
        });
      }
    });
    return dur;
  } });
}

// --- piano: soft felt-piano notes and open intervals in C major pentatonic
function piano(out) {
  const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79].map(hz);   // C4 .. G5
  const BASS = [36, 43, 45, 41].map(hz);                         // C2 G2 A2 F2
  let idx = 4, count = 0;
  gens.push({ next: 0, make(t) {
    if (count++ % 6 === 0) key(pick(BASS), t, out, 0.7);
    if (Math.random() < 0.12) return rand(5, 9);
    idx = Math.max(0, Math.min(SCALE.length - 1, idx + pick([-2, -1, -1, 1, 1, 2])));
    key(SCALE[idx], t, out, rand(0.6, 1));
    if (Math.random() < 0.3 && idx >= 2) key(SCALE[idx - 2], t + rand(0, 0.08), out, 0.5);
    return rand(1.8, 4.5);
  } });
}

function key(f, t, out, strength) {
  const { ctx } = A;
  const lp = filter('lowpass', 1600, 0.4);
  const g = gain(0.045 * strength);
  chain(lp, g, out);
  for (let n = 1; n <= 5; n++) {
    const o = ctx.createOscillator();
    const og = gain(0);
    const amp = 1 / Math.pow(n, 1.6), decay = 4.5 / Math.sqrt(n);
    o.frequency.value = f * n * (1 + 0.0004 * n * n);  // slight stretch, like real strings
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(amp, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    chain(o, og, lp);
    o.start(t); o.stop(t + decay + 0.1);
  }
}
