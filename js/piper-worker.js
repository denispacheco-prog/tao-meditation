// Runs Piper off the main thread, so the scene keeps moving while a
// sentence is being synthesized. Messages: load (model bytes + config)
// and synth (text) -> samples. The page sends one request at a time.

import * as ort from '../vendor/onnxruntime-web-1.30.0/ort.wasm.min.mjs';
import createPhonemize from '../vendor/piper-phonemize-1.0.0/piper_phonemize.mjs';
import { createPiper } from './piper-core.js';

ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime-web-1.30.0/', import.meta.url).href;
ort.env.wasm.numThreads = 1;   // GitHub Pages is not cross-origin isolated: no threads
const PHONEMIZE = new URL('../vendor/piper-phonemize-1.0.0/', import.meta.url).href;

const piper = createPiper({ ort, createPhonemize, locateFile: f => PHONEMIZE + f });
let loaded = null;

self.onmessage = async ({ data: m }) => {
  try {
    const p = await piper;
    if (m.type === 'load') {
      if (loaded !== m.voice) {
        loaded = null;
        await p.load(new Uint8Array(m.model), m.config);
        loaded = m.voice;
      }
      self.postMessage({ id: m.id });
    } else if (m.type === 'synth') {
      const { pcm, sampleRate } = await p.synth(m.text, m.slow, { noise: m.noise, w: m.w });
      self.postMessage({ id: m.id, pcm, sampleRate }, [pcm.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: m.id, error: String((e && e.message) || e) });
  }
};
