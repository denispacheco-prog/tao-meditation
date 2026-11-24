// A private journal kept only on this device (localStorage): the sessions done
// (date, minutes, how it felt) and the verses saved with ♡.

const KEY = 'tao-meditation-journal';

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY)) || {};
    return { sessions: j.sessions || [], saved: j.saved || [] };
  } catch (e) { return { sessions: [], saved: [] }; }
}
function save(j) {
  try { localStorage.setItem(KEY, JSON.stringify(j)); } catch (e) { /* ignore */ }
}

// Local calendar date as YYYY-MM-DD.
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- sessions ----------
// Returns the entry's position, to attach a mood to it afterwards.
export function logSession({ id, minutes }) {
  const j = load();
  j.sessions.push({ d: dateKey(), m: Math.round(minutes * 10) / 10, id });
  if (j.sessions.length > 3000) j.sessions.splice(0, j.sessions.length - 3000);
  save(j);
  return j.sessions.length - 1;
}

export function setMood(index, mood) {
  const j = load();
  if (j.sessions[index]) { j.sessions[index].mood = mood; save(j); }
}

// Minutes per day for the last n days, oldest first: [{ date, minutes }].
export function lastDays(n = 7) {
  const per = minutesByDay();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    out.push({ date: d, minutes: per[k] || 0 });
  }
  return out;
}

function minutesByDay() {
  const per = {};
  for (const s of load().sessions) per[s.d] = (per[s.d] || 0) + s.m;
  return per;
}

// One month: minutes per day, totals and moods. month is 0-based.
export function monthSummary(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const list = load().sessions.filter(s => s.d.startsWith(prefix));
  const days = {};
  const moods = { calm: 0, neutral: 0, tense: 0 };
  for (const s of list) {
    days[Number(s.d.slice(8))] = (days[Number(s.d.slice(8))] || 0) + s.m;
    if (s.mood in moods) moods[s.mood]++;
  }
  return {
    days,
    sessions: list.length,
    minutes: Math.round(list.reduce((t, s) => t + s.m, 0)),
    moods
  };
}

// ---------- saved verses ----------
const same = (a, ch, lines) => a.ch === ch && a.lines.join('\n') === lines.join('\n');

export const savedVerses = () => load().saved.slice().reverse();     // newest first
export const isSaved = (ch, lines) => load().saved.some(a => same(a, ch, lines));

export function toggleSaved(ch, lines) {
  const j = load();
  const i = j.saved.findIndex(a => same(a, ch, lines));
  if (i >= 0) j.saved.splice(i, 1);
  else j.saved.push({ ch, lines, at: dateKey() });
  save(j);
  return i < 0;                                   // true = now saved
}
