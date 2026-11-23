// Picks Tao Te Ching passages by theme so sessions don't repeat the same lines.
// Chapters used recently are avoided; only short stanzas are chosen.
// Chapter numbers are standard across translations.

export const THEMES = {
  // emptiness, quiet, settling
  stillness: [4, 5, 6, 11, 15, 16, 26, 37, 45, 47, 52, 56],
  // softness, yielding, the body
  softness: [8, 10, 22, 28, 43, 55, 76, 78],
  // non-doing, dropping, contentment
  'letting-go': [2, 7, 9, 12, 13, 20, 29, 33, 44, 46, 48, 63, 64, 81],
  // water, rivers, the way things flow
  nature: [6, 8, 23, 25, 32, 34, 66, 78]
};

const RECENT_KEY = 'tao-meditation-recent';
const RECENT_MAX = 30;

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
}

export function rememberChapters(chapters) {
  const recent = [...chapters, ...loadRecent().filter(c => !chapters.includes(c))].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch (e) { /* ignore */ }
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns { chapter, lines } or null (book not loaded / nothing short enough).
// exclude: chapters already used in this session.
export async function pickPassage(theme, { maxLines = 8, exclude = [], getChapter }) {
  const pool = THEMES[theme] || Object.values(THEMES).flat();
  const recent = loadRecent();
  // fresh chapters first (random order), then the least recently used ones
  const fresh = shuffle(pool.filter(c => !recent.includes(c) && !exclude.includes(c)));
  const stale = pool.filter(c => recent.includes(c) && !exclude.includes(c))
    .sort((a, b) => recent.indexOf(b) - recent.indexOf(a));
  for (const n of [...fresh, ...stale]) {
    const ch = await getChapter(n).catch(() => null);
    if (!ch || !ch.stanzas?.length) continue;
    const all = ch.stanzas.flat();
    const options = ch.stanzas.filter(s => s.length >= 2 && s.length <= maxLines);
    if (all.length <= maxLines) options.push(all);          // the whole chapter is short enough
    if (!options.length) continue;
    return { chapter: n, lines: options[Math.floor(Math.random() * options.length)] };
  }
  return null;
}
