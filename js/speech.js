// Text-to-speech via the browser (Web Speech API).
// Text is spoken one sentence at a time: Chrome on Android is more
// reliable with short utterances, and pausing can resume per sentence.

const synth = window.speechSynthesis;
let voice = null;
let rate = 0.85;
let pitch = 1.0;

export const speechAvailable = () => !!synth;

export function listVoices() {
  return new Promise(resolve => {
    if (!synth) return resolve([]);
    const pick = () => synth.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang));
    const now = pick();
    if (now.length) return resolve(now);
    synth.addEventListener('voiceschanged', () => resolve(pick()), { once: true });
    setTimeout(() => resolve(pick()), 1500);
  });
}

export function configure({ voiceURI, rate: r, pitch: p } = {}) {
  if (r) rate = r;
  if (p) pitch = p;
  if (voiceURI !== undefined && synth) {
    voice = synth.getVoices().find(v => v.voiceURI === voiceURI) || null;
  }
}

export const getRate = () => rate;

export function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]*\s*/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

// Rough duration estimate in seconds (used to plan the session).
export function estimate(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / (155 * rate)) * 60 + 0.4 * splitSentences(text).length;
}

// Speak one utterance. Resolves when it ends (or a safety timeout fires,
// because 'end' occasionally never arrives on Android).
export function speakOne(text) {
  return new Promise(resolve => {
    if (!synth) return setTimeout(resolve, estimate(text) * 1000);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'en-US';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
    const guard = setTimeout(finish, (estimate(text) * 2 + 4) * 1000);
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

export function stopSpeech() { if (synth) synth.cancel(); }
