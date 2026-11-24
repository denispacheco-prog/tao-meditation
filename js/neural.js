// Natural voices: Piper models that run on this device.
// The model is downloaded once from Hugging Face and kept in Cache Storage;
// the text never leaves the device. Synthesized sentences are kept too
// (on this device only), so a sentence heard before plays at once.
//
// Two voices, each with its own tuning, chosen by ear from samples:
//   tempo  stretches the speech (on top of the Speed slider, 1 = as set)
//   noise  noise_scale: lower = steadier, calmer delivery
//   w      noise_w: lower = more even rhythm, more articulated
//   pitch  playback rate: below 1 lowers the voice (length is compensated)
//   gap    extra silence after each sentence (s)
//   room   a small, soft room around the voice (0 = dry, 1 = full)

import { getAudio } from './audio.js';

export const NEURAL_VOICES = [
  { id: 'en_GB-jenny_dioco-medium', path: 'en/en_GB/jenny_dioco/medium', name: 'Jenny', gender: 'female', mb: 63,
    tune: { tempo: 1.105, noise: 0.5, w: 0.55, pitch: 0.94, gap: 0.9, room: 0.6 } },
  { id: 'en_GB-alan-medium', path: 'en/en_GB/alan/medium', name: 'Alan', gender: 'male', mb: 63,
    tune: { tempo: 1, noise: null, w: null, pitch: 1, gap: 0.4, room: 0 } },
];

const MODELS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const VOICE_CACHE = 'tao-voices';     // models (kept across app updates, see sw.js)
const SPEECH_CACHE = 'tao-speech';    // synthesized sentences
const PREFIX = 'piper:';

export const isNeural = uri => typeof uri === 'string' && uri.startsWith(PREFIX);
export const neuralURI = id => PREFIX + id;
export const neuralVoice = uri => NEURAL_VOICES.find(v => neuralURI(v.id) === uri) || null;

// ---------- worker ----------
let worker = null;
let seq = 0;
const calls = new Map();

function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const c = calls.get(data.id);
      if (!c) return;
      calls.delete(data.id);
      data.error ? c.reject(new Error(data.error)) : c.resolve(data);
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'The voice engine failed to start.');
      calls.forEach(c => c.reject(err));
      calls.clear();
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

// ---------- model download ----------
async function cached(url, onProgress) {
  const cache = await caches.open(VOICE_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    if (onProgress && total) onProgress(loaded / total);
  }
  const blob = new Blob(parts);
  await cache.put(url, new Response(blob));
  return blob.arrayBuffer();
}

export async function isDownloaded(id) {
  const v = NEURAL_VOICES.find(x => x.id === id);
  if (!v || !('caches' in self)) return false;
  const cache = await caches.open(VOICE_CACHE);
  return !!(await cache.match(`${MODELS}${v.path}/${v.id}.onnx`));
}

export async function forgetVoices() {
  await Promise.all([caches.delete(VOICE_CACHE), caches.delete(SPEECH_CACHE)]);
  current = null; ready = null; isReady = false; memory.clear();
}

// Frees the space of voices the app no longer offers (models and their sentences).
export async function pruneVoices() {
  if (!('caches' in self)) return;
  const keep = url => NEURAL_VOICES.some(v => url.includes(v.id));
  for (const name of [VOICE_CACHE, SPEECH_CACHE]) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) if (!keep(req.url)) await cache.delete(req);
  }
}

// ---------- voice selection and tuning ----------
let current = null;       // voice id
let ready = null;         // promise: model loaded in the worker
let isReady = false;
let rate = 0.85;          // Speed slider (0.6–1.1)
let tone = 1;             // Tone slider (0.7–1.3)

export const neuralReady = () => isReady;
const tuneOf = () => (NEURAL_VOICES.find(v => v.id === current) || NEURAL_VOICES[0]).tune;

export function useVoice(id, onProgress) {
  if (current === id && ready) return ready;
  const v = NEURAL_VOICES.find(x => x.id === id);
  if (!v) return Promise.reject(new Error('Unknown voice.'));
  current = id; isReady = false; memory.clear();
  const base = `${MODELS}${v.path}/${v.id}`;
  const p = (async () => {
    const config = JSON.parse(new TextDecoder().decode(await cached(base + '.onnx.json')));
    const model = await cached(base + '.onnx', onProgress);
    await call({ type: 'load', voice: id, model, config }, [model]);
    if (current === id) isReady = true;
  })();
  ready = p;
  p.catch(() => { if (ready === p) { ready = null; current = null; } });
  return p;
}

export function setNeuralRate(r) { r = r || 0.85; if (r !== rate) { rate = r; memory.clear(); } }
export function setNeuralTone(t) { t = t || 1; if (t !== tone) { tone = t; memory.clear(); } }

// What the synthesis and the playback use right now.
function params() {
  const t = tuneOf();
  const playRate = t.pitch * (1 + (tone - 1) * 0.5);       // the slider moves the voice by half as much
  return {
    slow: (t.tempo / rate) * playRate,                     // pre-shortened: playback at playRate stretches it back
    playRate, noise: t.noise, w: t.w, gap: t.gap, room: t.room
  };
}

// ---------- synthesis (one sentence at a time, in order) ----------
const memory = new Map();          // key -> Promise<AudioBuffer>
let queue = Promise.resolve();

const keyFor = (text, p) =>
  `https://speech.invalid/${current}/${p.slow.toFixed(3)}-${p.gap}/${encodeURIComponent(text)}`;

function toBuffer(pcm, sampleRate) {
  const buf = new AudioBuffer({ length: Math.max(1, pcm.length), numberOfChannels: 1, sampleRate });
  buf.copyToChannel(pcm, 0);
  return buf;
}

async function synthesize(text, key, p) {
  const store = await caches.open(SPEECH_CACHE).catch(() => null);
  const hit = store && await store.match(key);
  if (hit) {
    const sr = Number(hit.headers.get('x-sample-rate'));
    return toBuffer(new Float32Array(await hit.arrayBuffer()), sr);
  }
  await ready;
  const { pcm: raw, sampleRate } = await call({ type: 'synth', text, slow: p.slow, noise: p.noise, w: p.w });
  // silence after the sentence (it will be played at playRate)
  const pad = Math.round(p.gap * sampleRate * p.playRate);
  const pcm = new Float32Array(raw.length + pad);
  pcm.set(raw);
  const buffer = toBuffer(pcm, sampleRate);
  if (store) store.put(key, new Response(pcm.buffer, { headers: { 'x-sample-rate': String(sampleRate) } })).catch(() => {});
  return buffer;
}

export function synth(text) {
  const p = params();
  const key = keyFor(text, p);
  if (!memory.has(key)) {
    const job = queue.then(() => synthesize(text, key, p));
    queue = job.catch(() => {});
    job.catch(() => memory.delete(key));
    memory.set(key, job);
    if (memory.size > 400) memory.delete(memory.keys().next().value);
  }
  return memory.get(key);
}

// Queue a whole session's sentences in order. Resolves when all are ready;
// onProgress(done, total) reports along the way.
export function prefetch(texts, onProgress) {
  const unique = [...new Set(texts)];
  let done = 0;
  return Promise.all(unique.map(t => synth(t).then(() => onProgress && onProgress(++done, unique.length))));
}

// ---------- the room around the voice ----------
// A gentle low-pass blended with the dry voice (softens sibilance) and a few
// sparse, fading reflections: a small soft room, not a hall.
const TAPS = [[0.023, 0.22], [0.041, 0.17], [0.067, 0.13], [0.097, 0.1], [0.131, 0.07], [0.173, 0.05], [0.229, 0.03]];
const rooms = new Map();           // room amount -> input node

function voiceInput(audio, room) {
  if (!room) return audio.master;
  if (rooms.has(room)) return rooms.get(room);
  const { ctx, master } = audio;
  const input = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.45;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500; lp.Q.value = 0.5;
  const soft = ctx.createGain(); soft.gain.value = 0.55;
  input.connect(dry).connect(master);
  input.connect(lp).connect(soft).connect(master);
  const len = Math.ceil(ctx.sampleRate * 0.25);
  const ir = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = ir.getChannelData(0);
  for (const [t, g] of TAPS) d[Math.round(t * ctx.sampleRate)] = g * room;
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = ir;
  input.connect(conv).connect(master);
  rooms.set(room, input);
  return input;
}

// ---------- playback ----------
let playing = null;
let generation = 0;

export async function speakNeural(text) {
  const gen = generation;
  const p = params();
  const buffer = await synth(text);
  const audio = getAudio();
  if (gen !== generation || !audio) return;          // stopped while preparing
  const src = audio.ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = p.playRate;
  src.connect(voiceInput(audio, p.room));
  await new Promise(resolve => {
    playing = { src, resolve };
    src.onended = () => { if (playing && playing.src === src) playing = null; resolve(); };
    src.start();
  });
}

export function stopNeural() {
  generation++;
  if (playing) {
    const { src, resolve } = playing;
    playing = null;
    try { src.stop(); } catch (e) { /* already stopped */ }
    resolve();
  }
}
