// Natural voices (beta): Piper models that run on this device.
// The model is downloaded once from Hugging Face and kept in Cache Storage;
// the text never leaves the device. Synthesized sentences are kept too
// (on this device only), so a sentence heard before plays at once.

import { getAudio } from './audio.js';

export const NEURAL_VOICES = [
  { id: 'en_GB-alba-medium', path: 'en/en_GB/alba/medium', label: 'Scottish · Alba', gender: 'Female', mb: 63 },
  { id: 'en_US-hfc_female-medium', path: 'en/en_US/hfc_female/medium', label: 'American · HFC', gender: 'Female', mb: 63 },
  // High quality, but several times slower: a session prepares it before starting.
  { id: 'en_US-ryan-high', path: 'en/en_US/ryan/high', label: 'American · Ryan', gender: 'Male', mb: 121, slow: true },
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

// ---------- voice selection ----------
let current = null;       // voice id
let ready = null;         // promise: model loaded in the worker
let isReady = false;
let slow = 1 / 0.85;      // Piper length scale factor (from the Speed slider)

export const neuralReady = () => isReady;

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

// Speed slider (0.6–1.1, 0.85 by default) -> how much to stretch the speech.
export function setNeuralRate(rate) {
  const next = 1 / (rate || 0.85);
  if (Math.abs(next - slow) > 1e-6) { slow = next; memory.clear(); }
}

// ---------- synthesis (one sentence at a time, in order) ----------
const memory = new Map();          // key -> Promise<AudioBuffer>
let queue = Promise.resolve();

const keyFor = text => `https://speech.invalid/${current}/${slow.toFixed(3)}/${encodeURIComponent(text)}`;

function toBuffer(pcm, sampleRate) {
  const buf = new AudioBuffer({ length: Math.max(1, pcm.length), numberOfChannels: 1, sampleRate });
  buf.copyToChannel(pcm, 0);
  return buf;
}

async function synthesize(text, key) {
  const store = await caches.open(SPEECH_CACHE).catch(() => null);
  const hit = store && await store.match(key);
  if (hit) {
    const rate = Number(hit.headers.get('x-sample-rate'));
    return toBuffer(new Float32Array(await hit.arrayBuffer()), rate);
  }
  await ready;
  const { pcm, sampleRate } = await call({ type: 'synth', text, slow });
  const buffer = toBuffer(pcm, sampleRate);
  if (store) store.put(key, new Response(pcm.buffer, { headers: { 'x-sample-rate': String(sampleRate) } })).catch(() => {});
  return buffer;
}

export function synth(text) {
  const key = keyFor(text);
  if (!memory.has(key)) {
    const p = queue.then(() => synthesize(text, key));
    queue = p.catch(() => {});
    p.catch(() => memory.delete(key));
    memory.set(key, p);
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

// ---------- playback ----------
let playing = null;
let generation = 0;

export async function speakNeural(text) {
  const gen = generation;
  const buffer = await synth(text);
  const audio = getAudio();
  if (gen !== generation || !audio) return;          // stopped while preparing
  const src = audio.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(audio.master);
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
