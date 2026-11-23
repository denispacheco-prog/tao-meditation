import { importEpub } from './epub.js';
import { saveChapters, countChapters, clearBook, askPersistence, loadSettings, saveSettings } from './store.js';
import { listVoices, configure, speakOne, stopSpeech, speechAvailable } from './speech.js';
import { initAudio } from './audio.js';
import { Player } from './player.js';
import { setScene, setBreath, setTheme, SCENES } from './scene.js';
import { startAmbience, stopAmbience, setAmbienceVolume, duck, pauseAmbience } from './ambience.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST_SPEED = Math.max(1, Number(params.get('fast')) || 1);   // e.g. ?fast=20 for testing

let settings = { rate: 0.85, pitch: 1, voiceURI: '', minutes: {}, session: '', scene: 'water', ambience: 'nature', ambienceVolume: 0.5, music: 'vary', theme: 'day', shuffle: true, ...loadSettings() };
let scripts = [];
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
const REGIONS = {
  US: 'American', GB: 'British', AU: 'Australian', IN: 'Indian', IE: 'Irish',
  ZA: 'South African', NZ: 'New Zealand', CA: 'Canadian', NG: 'Nigerian', SG: 'Singapore'
};

// The Web Speech API does not say whether a voice is male or female,
// so guess from well-known voice names and Google's Android voice codes.
const FEMALE = /\b(female|woman|zira|aria|jenny|hazel|susan|samantha|karen|moira|tessa|libby|sonia|natasha|clara|emma|michelle|ava|allison|serena|victoria|fiona|veena|kate|catherine|heera|neerja|joanna|salli|kimberly|ivy|amy|olivia|ana|emily|sara|nicky|martha|isla|maisie|linda|heather)\b|-x-(sfg|tpf|tpc|iob|iog|gba|gbc|gbg|fis|aua|aub|enc|ahp|cxx)\b/i;
const MALE = /\b(male|man|david|mark|guy|ryan|george|daniel|james|thomas|brian|christopher|eric|roger|steffan|william|liam|aaron|fred|alex|tom|oliver|arthur|rishi|gordon|lee|ravi|prabhat|matthew|joey|justin|kevin|russell|reed|eddy)\b|-x-(tpd|iom|iol|gbb|gbd|rjs|aud|auc|end)\b/i;
function voiceGender(v) {
  const s = `${v.name} ${v.voiceURI}`;
  if (FEMALE.test(s)) return 'Female';
  if (MALE.test(s)) return 'Male';
  return 'Other';
}

function voiceLabel(v) {
  const region = REGIONS[(v.lang.split(/[-_]/)[1] || '').toUpperCase()] || v.lang;
  const name = v.name.replace(/^(Microsoft|Google|Apple)\s+/i, '').replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*-\s*English.*$/i, '').replace(/^English\s*/i, '').trim();
  return name ? `${region} · ${name}` : region;
}

async function setupVoice() {
  if (!speechAvailable()) {
    $('voice-section').innerHTML = '<h2>Voice</h2><p class="note">This browser has no speech synthesis.</p>';
    return;
  }
  const voices = (await listVoices())
    .map(v => ({ v, label: voiceLabel(v), gender: voiceGender(v) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const sel = $('voice');
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const option = ({ v, label }) =>
    `<option value="${esc(v.voiceURI)}">${esc(label)}${v.localService ? '' : ' (online)'}</option>`;
  const groups = ['Female', 'Male', 'Other']
    .map(g => [g, voices.filter(x => x.gender === g)])
    .filter(([, list]) => list.length);
  sel.innerHTML = groups.length === 1 && groups[0][0] === 'Other'
    ? groups[0][1].map(option).join('')
    : groups.map(([g, list]) => `<optgroup label="${g}">${list.map(option).join('')}</optgroup>`).join('');
  if (!voices.length) sel.innerHTML = '<option value="">Default</option>';
  if (settings.voiceURI && voices.some(({ v }) => v.voiceURI === settings.voiceURI)) sel.value = settings.voiceURI;
  else settings.voiceURI = sel.value;
  $('rate').value = settings.rate;
  $('pitch').value = settings.pitch;
  showVoiceValues();
  configure(settings);
}

function showVoiceValues() {
  $('rate-val').textContent = settings.rate.toFixed(2);
  $('pitch-val').textContent = settings.pitch.toFixed(2);
}

function preview() {
  stopSpeech();
  speakOne('Find a comfortable position, and let your breath settle.');
}

$('voice').addEventListener('change', e => {
  settings.voiceURI = e.target.value; configure(settings); saveSettings(settings); preview();
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
const current = () => scripts.find(s => s.id === settings.session) || scripts[0];
const chosenMinutes = s => {
  const m = settings.minutes[s.id];
  return s.durations.includes(m) ? m : s.defaultDuration;
};

async function loadSessions() {
  const files = await fetch('sessions/index.json').then(r => r.json());
  scripts = await Promise.all(files.map(f => fetch('sessions/' + f).then(r => r.json())));
  renderSessions();
}

function renderSessions() {
  const sel = current();
  const list = $('sessions');
  list.innerHTML = '';
  for (const s of scripts) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'session';
    b.setAttribute('aria-pressed', String(s === sel));
    b.innerHTML = `<span class="t"></span><span class="d"></span>`;
    b.querySelector('.t').textContent = s.title;
    b.querySelector('.d').textContent = s.description || '';
    b.addEventListener('click', () => { settings.session = s.id; saveSettings(settings); renderSessions(); });
    li.appendChild(b);
    list.appendChild(li);
  }
  renderDurations();
}

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
  player = new Player(script, { minutes, speed: TEST_SPEED, onUpdate: render });
  const clock = setInterval(() => player && render({ paused: player.paused, elapsed: player.elapsed(), total: player.total }), 1000);
  try { await player.run(); } finally {
    clearInterval(clock);
    if (!player.stopped) await new Promise(r => setTimeout(r, 2500 / TEST_SPEED));
    end();
  }
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
