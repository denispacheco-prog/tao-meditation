// Background sound, synthesized on the device (Web Audio API): no files, no licences.
//   nature: follows the scene: water → waves, wind → wind, grass → meadow crickets, light → soft rain
//   music:  a low drone with slow, sparse kalimba-like notes in G major pentatonic (same key as the bell)
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
export function startAmbience({ ambience = 'none', scene = 'water', ambienceVolume = 0.5 }) {
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
  if (ambience === 'music' || ambience === 'both') startMusic();
  for (const g of gens) g.next = ctx.currentTime + 0.1;
  plan();
  timer = setInterval(plan, 1000);
  apply(6);
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
  const s = ctx.createBufferSource();
  s.buffer = buffers[key];
  s.loop = true;
  s.start(0, rand(0, 5));
  loops.push(s);
  return s;
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
  else if (scene === 'light') rain(out);
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
const SCALE = [392, 440, 493.88, 587.33, 659.25, 783.99, 880, 987.77, 1174.66];   // G A B D E, G4..D6
const PAD = [98, 110, 123.47, 146.83, 164.81];                                      // G2 A2 B2 D3 E3

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

function startMusic() {
  const { ctx } = A;
  const music = gain(0.6);
  const dry = gain(0.55), wet = gain(0.8);
  const rev = reverb();
  music.connect(dry).connect(bus);
  music.connect(rev).connect(wet).connect(bus);

  // drone: G and D, always there
  const droneLp = filter('lowpass', 650, 0.5);
  const droneGain = gain(0.05);
  droneLp.connect(droneGain).connect(music);
  for (const [f, type, detune] of [[98, 'sine', 0], [98, 'triangle', 4], [146.83, 'sine', -3]]) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.connect(droneLp);
    o.start();
    loops.push(o);
  }

  // slow pad notes drifting in and out over the drone
  gens.push({ next: 0, make(t) {
    const dur = rand(16, 26);
    const o = ctx.createOscillator();
    const lp = filter('lowpass', 900, 0.5);
    const g = gain(0);
    o.type = 'triangle';
    o.frequency.value = pick(PAD) * 2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 6);
    g.gain.setValueAtTime(0.025, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 8);
    chain(o, lp, g, music);
    o.start(t); o.stop(t + dur + 8.5);
    return dur;
  } });

  // sparse melody: a slow random walk on the pentatonic scale
  let idx = 3;
  gens.push({ next: 0, make(t) {
    if (Math.random() < 0.15) return rand(6, 11);             // a longer silence now and then
    idx = Math.max(0, Math.min(SCALE.length - 1, idx + pick([-2, -1, -1, 1, 1, 2])));
    pluck(SCALE[idx], t, music);
    if (Math.random() < 0.2 && idx >= 2) pluck(SCALE[idx - 2], t + rand(0.05, 0.4), music, 0.6);
    return rand(2.5, 6.5);
  } });
}

function pluck(f, t, out, strength = 1) {
  const { ctx } = A;
  const g = gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06 * strength, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
  g.connect(out);
  // fundamental plus a quiet, quickly fading overtone: a soft tine
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
