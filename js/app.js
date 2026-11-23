import { importEpub } from './epub.js';
import { saveChapters, countChapters, clearBook, askPersistence, loadSettings, saveSettings } from './store.js';
import { listVoices, configure, speakOne, stopSpeech, speechAvailable } from './speech.js';
import { initAudio } from './audio.js';
import { Player } from './player.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST_SPEED = Math.max(1, Number(params.get('fast')) || 1);   // e.g. ?fast=20 for testing

let settings = { rate: 0.85, voiceURI: '', minutes: {}, ...loadSettings() };
let player = null;
let wakeLock = null;

// ---------- book ----------
async function refreshBook() {
  const n = await countChapters().catch(() => 0);
  $('book-status').textContent = n
    ? `Tao Te Ching loaded: ${n} chapters on this device.`
    : 'No book loaded yet.';
  $('book-remove').hidden = !n;
  $('book-load').firstChild.textContent = n ? 'Replace EPUB ' : 'Load EPUB ';
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

// ---------- voice ----------
async function setupVoice() {
  if (!speechAvailable()) {
    $('settings').innerHTML = '<h2>Voice</h2><p class="note">This browser has no speech synthesis.</p>';
    return;
  }
  const voices = await listVoices();
  const sel = $('voice');
  sel.innerHTML = voices.map(v =>
    `<option value="${v.voiceURI}">${v.name} (${v.lang})${v.localService ? '' : ' · online'}</option>`
  ).join('') || '<option value="">Default</option>';
  if (settings.voiceURI && voices.some(v => v.voiceURI === settings.voiceURI)) sel.value = settings.voiceURI;
  else settings.voiceURI = sel.value;
  $('rate').value = settings.rate;
  $('rate-val').textContent = settings.rate.toFixed(2);
  configure(settings);
}

$('voice').addEventListener('change', e => { settings.voiceURI = e.target.value; configure(settings); saveSettings(settings); });
$('rate').addEventListener('input', e => {
  settings.rate = Number(e.target.value);
  $('rate-val').textContent = settings.rate.toFixed(2);
  configure(settings); saveSettings(settings);
});
$('voice-test').addEventListener('click', () => {
  stopSpeech();
  speakOne('Find a comfortable position, and let your breath settle.');
});

// ---------- sessions ----------
async function loadSessions() {
  const files = await fetch('sessions/index.json').then(r => r.json());
  const scripts = await Promise.all(files.map(f => fetch('sessions/' + f).then(r => r.json())));
  const box = $('sessions');
  box.innerHTML = '';
  for (const s of scripts) {
    const chosen = settings.minutes[s.id] || s.defaultDuration;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h2>Practice</h2>
      <p class="session-title">${s.title}</p>
      <p class="session-desc">${s.description || ''}</p>
      <div class="row durations">${s.durations.map(m =>
        `<button class="btn chip" data-min="${m}" aria-pressed="${m === chosen}">${m} min</button>`).join('')}</div>
      <button class="btn start">Begin</button>`;
    card.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      card.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      settings.minutes[s.id] = Number(b.dataset.min);
      saveSettings(settings);
    }));
    card.querySelector('.start').addEventListener('click', () =>
      start(s, settings.minutes[s.id] || s.defaultDuration));
    box.appendChild(card);
  }
}

// ---------- session screen ----------
function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function render(state) {
  const c = $('circle');
  if (state.phase === 'inhale') {
    c.style.transitionDuration = state.seconds + 's';
    c.classList.add('in');
    $('label').textContent = '';
  } else if (state.phase === 'exhale') {
    c.style.transitionDuration = state.seconds + 's';
    c.classList.remove('in');
    $('label').textContent = state.label;
  } else if (state.phase) {
    c.style.transitionDuration = '3s';
    c.classList.remove('in');
    $('label').textContent = '';
  }
  if (state.phase === 'done') $('label').textContent = '';
  $('remaining').textContent = state.paused ? 'paused' : fmt(state.total - state.elapsed);
  $('pause').textContent = state.paused ? 'Resume' : 'Pause';
}

async function lockScreenOn() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (player && document.visibilityState === 'visible') lockScreenOn();
});

async function start(script, minutes) {
  initAudio();                       // must happen inside the tap
  configure(settings);
  $('home').hidden = true;
  $('session').hidden = false;
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
  try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
  $('session').hidden = true;
  $('home').hidden = false;
}

$('pause').addEventListener('click', () => { if (!player) return; player.paused ? player.resume() : player.pause(); });
$('stop').addEventListener('click', () => { if (player) player.stop(); });

// ---------- boot ----------
refreshBook();
setupVoice();
loadSessions();
if ('serviceWorker' in navigator && TEST_SPEED === 1) navigator.serviceWorker.register('sw.js').catch(() => {});
