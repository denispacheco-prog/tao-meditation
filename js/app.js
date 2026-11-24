import { importEpub } from './epub.js';
import { saveChapters, countChapters, clearBook, askPersistence, loadSettings, saveSettings } from './store.js';
import { configure, speakOne, stopSpeech, prepare, naturalVoice } from './speech.js';
import { NEURAL_VOICES, neuralURI, neuralVoice, useVoice, isDownloaded, forgetVoices, pruneVoices } from './neural.js';
import { initAudio } from './audio.js';
import { Player } from './player.js';
import { setScene, setBreath, setTheme, SCENES } from './scene.js';
import { pickPassage, rememberChapters } from './tao.js';
import { getChapter } from './store.js';
import { startAmbience, stopAmbience, setAmbienceVolume, duck, pauseAmbience } from './ambience.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST_SPEED = Math.max(1, Number(params.get('fast')) || 1);   // e.g. ?fast=20 for testing

let settings = { rate: 0.85, pitch: 1, voiceURI: '', minutes: {}, session: '', scene: 'water', ambience: 'nature', ambienceVolume: 0.5, music: 'vary', theme: 'day', shuffle: true, mode: 'practice', picked: {}, ...loadSettings() };
if (!settings.picked) settings.picked = {};
let scripts = [];
let pools = {};
let player = null;
let wakeLock = null;

// ---------- book ----------
async function refreshBook() {
  const n = await countChapters().catch(() => 0);
  $('book-status').textContent = n
    ? `Tao Te Ching loaded · ${n} chapters on this device.`
    : 'No book loaded yet.';
  $('book-remove').hidden = !n;
  $('book-load').querySelector('span').textContent = n ? 'Replace EPUB' : 'Load EPUB';
  $('book-hint').hidden = !!n;
}

$('book-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('book-status').textContent = 'Reading the book…';
  try {
    const chapters = await importEpub(file);
    await saveChapters(chapters);
    await askPersistence();
    await refreshBook();
  } catch (err) {
    $('book-status').textContent = 'Could not read this file. ' + err.message;
  }
});

$('book-remove').addEventListener('click', async () => {
  if (!confirm('Remove the book from this device?')) return;
  await clearBook();
  refreshBook();
});

// ---------- settings sheet ----------
const sheet = $('settings');
$('open-settings').addEventListener('click', () => sheet.showModal());
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });   // tap outside closes
$('book-hint').addEventListener('click', () => sheet.showModal());

// ---------- surprise me ----------
// Picks a new theme and scene (never the same as last time); music varies per session.
const pickOther = (list, current) => {
  const options = list.filter(x => x !== current);
  return options[Math.floor(Math.random() * options.length)];
};
function shuffleLook() {
  settings.theme = pickOther(['day', 'dusk', 'night'], settings.theme);
  settings.scene = pickOther(SCENES, settings.scene);
  settings.music = 'vary';
  saveSettings(settings);
}
if (settings.shuffle) shuffleLook();

// When the app comes back after a long time in the background, it counts as a new visit.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (settings.shuffle && !player && hiddenAt && Date.now() - hiddenAt > 20 * 60 * 1000) {
    shuffleLook(); showTheme(); showScene(); showAmbience();
  }
});

// ---------- theme ----------
const THEME_BG = { day: '#ede7da', dusk: '#2a2f37', night: '#0f0e0b' };
function showTheme() {
  if (!THEME_BG[settings.theme]) settings.theme = 'day';
  document.documentElement.dataset.theme = settings.theme;
  document.querySelector('meta[name=theme-color]').content = THEME_BG[settings.theme];
  setTheme(settings.theme);
  document.querySelectorAll('#theme-choice button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.themeName === settings.theme)));
}
document.querySelectorAll('#theme-choice button').forEach(b => b.addEventListener('click', () => {
  settings.theme = b.dataset.themeName; saveSettings(settings); showTheme();
}));

// ---------- scene ----------
function showScene() {
  setScene(settings.scene);
  document.querySelectorAll('#scene-choice button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.scene === settings.scene)));
}
document.querySelectorAll('#scene-choice button').forEach(b => b.addEventListener('click', () => {
  settings.scene = b.dataset.scene; saveSettings(settings); showScene();
  if (previewing) previewSound();
}));

$('shuffle').addEventListener('change', e => { settings.shuffle = e.target.checked; saveSettings(settings); });

// ---------- background sound ----------
let previewing = null;
function showAmbience() {
  document.querySelectorAll('#amb-choice button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.amb === settings.ambience)));
  document.querySelectorAll('#music-choice button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.music === settings.music)));
  $('music-row').hidden = !(settings.ambience === 'music' || settings.ambience === 'both');
  $('amb-vol').value = settings.ambienceVolume;
  $('amb-test').textContent = previewing ? 'Stop' : 'Listen';
}
function previewSound() {
  initAudio();
  clearTimeout(previewing);
  startAmbience(settings);
  previewing = setTimeout(stopPreview, 15000);
  showAmbience();
}
function stopPreview() {
  if (!previewing) return;
  clearTimeout(previewing);
  previewing = null;
  stopAmbience(2);
  showAmbience();
}
document.querySelectorAll('#amb-choice button').forEach(b => b.addEventListener('click', () => {
  settings.ambience = b.dataset.amb; saveSettings(settings); showAmbience();
  if (previewing || settings.ambience !== 'none') previewSound();
  if (settings.ambience === 'none') stopPreview();
}));
document.querySelectorAll('#music-choice button').forEach(b => b.addEventListener('click', () => {
  settings.music = b.dataset.music; saveSettings(settings); showAmbience();
  previewSound();
}));
$('amb-vol').addEventListener('input', e => {
  settings.ambienceVolume = Number(e.target.value); saveSettings(settings);
  setAmbienceVolume(settings.ambienceVolume);
});
$('amb-test').addEventListener('click', () => previewing ? stopPreview() : previewSound());
sheet.addEventListener('close', stopPreview);

// ---------- voice ----------
// Two natural voices (Jenny, Alan); the phone's own voice only fills in until one is ready.
function setupVoice() {
  // voices from before (device voices, older natural ones) become Jenny, with neutral sliders
  if (!neuralVoice(settings.voiceURI)) {
    settings.voiceURI = neuralURI(NEURAL_VOICES[0].id);
    settings.rate = 0.85; settings.pitch = 1;
    saveSettings(settings);
  }
  const box = $('voice-choice');
  box.innerHTML = NEURAL_VOICES.map(v =>
    `<button type="button" data-voice="${neuralURI(v.id)}">${v.name} <small>· ${v.gender}</small></button>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    initAudio();                             // inside the tap, for the preview later
    settings.voiceURI = b.dataset.voice; saveSettings(settings);
    configure(settings); showVoiceValues(); loadNatural(true);
  }));
  $('rate').value = settings.rate;
  $('pitch').value = settings.pitch;
  showVoiceValues();
  configure(settings);
  loadNatural(false);
  pruneVoices().catch(() => {});
}

// Download (once) and load the chosen voice, showing progress.
async function loadNatural(thenPreview) {
  const v = neuralVoice(settings.voiceURI);
  const status = $('voice-status');
  if (!v) return;
  const fresh = !(await isDownloaded(v.id).catch(() => false));
  status.textContent = fresh ? `Downloading ${v.name}… (${v.mb} MB, only once)` : `Loading ${v.name}…`;
  try {
    await useVoice(v.id, f => { status.textContent = `Downloading ${v.name}… ${Math.round(f * 100)}%`; });
    if (settings.voiceURI !== neuralURI(v.id)) return;      // changed meanwhile
    configure(settings);
    status.textContent = `${v.name} is ready and works offline.`;
    if (thenPreview) preview();
  } catch (e) {
    status.textContent = `Could not load ${v.name} (${e.message}). The phone's voice is used instead.`;
  }
}

function showVoiceValues() {
  document.querySelectorAll('#voice-choice button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.voice === settings.voiceURI)));
  $('rate-val').textContent = settings.rate.toFixed(2);
  $('pitch-val').textContent = settings.pitch.toFixed(2);
}

function preview() {
  initAudio();                               // natural voices play through Web Audio
  stopSpeech();
  speakOne('Find a comfortable position, and let your breath settle.');
}

$('voice-forget').addEventListener('click', async () => {
  if (!confirm('Remove the downloaded natural voices from this device?')) return;
  await forgetVoices();
  $('voice-status').textContent = 'Removed. Tap a voice to download it again.';
});
for (const id of ['rate', 'pitch']) {
  $(id).addEventListener('input', e => {
    settings[id] = Number(e.target.value);
    showVoiceValues(); configure(settings); saveSettings(settings);
  });
  $(id).addEventListener('change', preview);
}
$('voice-test').addEventListener('click', preview);

// ---------- sessions ----------
const modeOf = s => s.mode || 'practice';
const inMode = () => scripts.filter(s => modeOf(s) === settings.mode);
const current = () => inMode().find(s => s.id === settings.picked[settings.mode]) ||
  inMode().find(s => s.id === settings.session) || inMode()[0];

// Hand-drawn symbols for the practice cards.
const ICONS = {
  dots: '<circle cx="16" cy="10" r="1.9" fill="currentColor"/><circle cx="10" cy="21" r="1.9" fill="currentColor"/><circle cx="22" cy="21" r="1.9" fill="currentColor"/>',
  square: '<rect x="8.5" y="8.5" width="15" height="15" rx="2"/>',
  wave: '<path d="M3 17c3.5-7 7-7 9.5 0s6 6.5 8.5 0 4.5-5 8-3"/>',
  body: '<circle cx="16" cy="7.5" r="3"/><path d="M16 11.5v15M10 16.5c2.5 1.5 9.5 1.5 12 0"/>',
  enso: '<path d="M21.5 6.8a10 10 0 1 0 4 6.7"/>',
  pulse: '<path d="M3 17h6l2.5-6 4 12 3-8 2 2H29"/>',
  release: '<path d="M6 9c4-3 8 3 12 0s6-2 8 0M6 16h20M6 23c5 0 10 1 20 0"/>',
  leaf: '<path d="M16 27C8 21 8 11 16 5c8 6 8 16 0 22z"/><path d="M16 27V13"/>'
};
const icon = name => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.enso}</svg>`;
const chosenMinutes = s => {
  const m = settings.minutes[s.id];
  return s.durations.includes(m) ? m : s.defaultDuration;
};

async function loadSessions() {
  const files = await fetch('sessions/index.json').then(r => r.json());
  scripts = await Promise.all(files.map(f => fetch('sessions/' + f).then(r => r.json())));
  pools = await fetch('sessions/pools.json').then(r => r.json()).catch(() => ({}));
  renderSessions();
}

function renderSessions() {
  const sel = current();
  const list = $('sessions');
  list.innerHTML = '';
  for (const s of inMode()) {
    const b = document.createElement('button');
    b.className = 'card';
    b.setAttribute('aria-pressed', String(s === sel));
    b.setAttribute('aria-label', s.title);
    b.innerHTML = icon(s.icon) + '<span></span>';
    b.querySelector('span').textContent = s.short || s.title;
    b.addEventListener('click', () => {
      settings.picked[settings.mode] = s.id; saveSettings(settings); renderSessions();
    });
    list.appendChild(b);
  }
  $('session-name').textContent = sel ? sel.title : '';
  document.querySelectorAll('.modes button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode)));
  renderDurations();
}

document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => {
  settings.mode = b.dataset.mode; saveSettings(settings); renderSessions();
}));

function renderDurations() {
  const s = current();
  const chosen = chosenMinutes(s);
  const box = $('durations');
  box.innerHTML = s.durations.map(m =>
    `<button class="dur" data-min="${m}" aria-pressed="${m === chosen}">${m}<small>min</small></button>`).join('');
  box.querySelectorAll('.dur').forEach(b => b.addEventListener('click', () => {
    settings.minutes[s.id] = Number(b.dataset.min);
    saveSettings(settings);
    renderDurations();
  }));
}

$('begin').addEventListener('click', () => { const s = current(); if (s) start(s, chosenMinutes(s)); });

// ---------- session screen ----------
function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function breathe(inhaling, seconds) {
  const c = $('circle');
  const lights = $('lights');
  c.style.transitionDuration = seconds + 's';
  lights.style.transitionDuration = `3s, ${seconds}s`;
  c.classList.toggle('in', inhaling);
  document.body.classList.toggle('inhale', inhaling);
  setBreath(inhaling, seconds);
}

function render(state) {
  if (state.phase === 'inhale') breathe(true, state.seconds);
  else if (state.phase === 'exhale') breathe(false, state.seconds);
  else if (state.phase && state.phase !== 'hold') breathe(false, 3);
  if (state.phase) duck(state.phase === 'speak' || state.phase === 'tao');
  if ('label' in state) $('label').textContent = state.phase === 'done' ? '' : state.label;
  $('remaining').textContent = state.paused ? 'paused' : fmt(state.total - state.elapsed);
  $('pause').textContent = state.paused ? 'resume' : 'pause';
}

// Controls fade away after a few seconds; any tap brings them back.
let quietTimer = null;
function wake() {
  $('session').classList.remove('quiet');
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => { if (player && !player.paused) $('session').classList.add('quiet'); }, 4000);
}
$('session').addEventListener('pointerdown', wake);

async function lockScreenOn() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (player && document.visibilityState === 'visible') lockScreenOn();
});

async function start(script, minutes) {
  initAudio();                       // must happen inside the tap
  stopSpeech();
  stopPreview();
  startAmbience(settings);
  configure(settings);
  $('home').hidden = true;
  $('session').hidden = false;
  $('label').textContent = '';
  document.body.classList.add('in-session');
  wake();
  await lockScreenOn();
  player = new Player(script, { minutes, speed: TEST_SPEED, onUpdate: render, prepare: prepareVoice, pools });
  const clock = setInterval(() => player && render({ paused: player.paused, elapsed: player.elapsed(), total: player.total }), 1000);
  let finished = false;
  try { await player.run(); finished = !player.stopped; } finally {
    clearInterval(clock);
    if (finished) {
      await new Promise(r => setTimeout(r, 2500 / TEST_SPEED));
      await showPassage(script, player.chapters);
    }
    end();
  }
}

// After a session that ran to the end: a short passage to read, gently moving,
// until the screen is tapped. Never one the voice just read; skipped without the book.
async function showPassage(script, used) {
  const theme = script.closing || ['stillness', 'letting-go', 'softness', 'nature'][Math.floor(Math.random() * 4)];
  const p = await pickPassage(theme, { maxLines: 8, exclude: used, getChapter }).catch(() => null);
  if (!p) return;
  rememberChapters([p.chapter]);
  const box = $('passage');
  const verses = box.querySelector('.verses');
  verses.innerHTML = '';
  p.lines.forEach((line, i) => {
    const el = document.createElement('p');
    el.textContent = line;
    el.style.animationDelay = `${0.8 + i * 1.1}s, ${-i * 0.9}s`;   // appear one by one; the wave travels down
    verses.appendChild(el);
  });
  const chapter = box.querySelector('.chapter');
  chapter.textContent = String(p.chapter);
  chapter.style.animationDelay = `${1.5 + p.lines.length * 1.1}s`;
  box.classList.remove('leaving', 'settled');
  box.hidden = false;
  $('session').classList.add('reading');
  $('session').classList.remove('quiet');
  breathe(false, 3);
  setBreath(null);
  duck(true);
  const settle = setTimeout(() => box.classList.add('settled'), (4 + p.lines.length * 4) * 1000);
  await new Promise(resolve => box.addEventListener('click', resolve, { once: true }));
  clearTimeout(settle);
  box.classList.add('leaving');
  await new Promise(r => setTimeout(r, 1200));
  box.hidden = true;
  $('session').classList.remove('reading');
}

// Natural voices synthesize the session's sentences ahead of time. Fast ones
// keep ahead during the pauses; slow ones (Ryan) prepare everything first.
async function prepareVoice(texts) {
  const v = naturalVoice();
  if (!v) return;
  // a sentence that fails here is retried (or falls back) when it is spoken
  const all = prepare(texts, (done, total) => {
    if (v.slow && player) $('label').textContent = `Preparing the voice… ${Math.round((done / total) * 100)}%`;
  }).catch(() => {});
  if (!v.slow) return;
  $('label').textContent = 'Preparing the voice…';
  await all;
  $('label').textContent = '';
}

function end() {
  if (player) player.stop();
  player = null;
  clearTimeout(quietTimer);
  try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
  breathe(false, 2);
  setBreath(null);
  stopAmbience(4);
  document.body.classList.remove('in-session', 'inhale');
  $('session').hidden = true;
  $('session').classList.remove('quiet');
  $('home').hidden = false;
}

$('pause').addEventListener('click', () => {
  if (!player) return;
  player.paused ? player.resume() : player.pause();
  pauseAmbience(player.paused);
  wake();
});
$('stop').addEventListener('click', () => { if (player) player.stop(); });

// ---------- boot ----------
$('shuffle').checked = settings.shuffle;
showTheme();
showScene();
showAmbience();
refreshBook();
setupVoice();
loadSessions();
if ('serviceWorker' in navigator && TEST_SPEED === 1) navigator.serviceWorker.register('sw.js').catch(() => {});
