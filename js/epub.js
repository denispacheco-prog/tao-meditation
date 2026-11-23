// Extracts the 81 chapters from the user's own EPUB of the
// Stephen Mitchell translation into { n, stanzas: [[line, ...], ...] }.
// Layout of that edition: OEBPS/chNN.xhtml > div.extract (stanza) > p (line).

import { readZip } from './zip.js';

export async function importEpub(file) {
  const zip = await readZip(await file.arrayBuffer());
  const chapterFiles = zip.names
    .map(name => ({ name, m: name.match(/(?:^|\/)ch(\d{1,3})\.x?html?$/i) }))
    .filter(x => x.m)
    .map(x => ({ name: x.name, n: parseInt(x.m[1], 10) }))
    .sort((a, b) => a.n - b.n);

  const parser = new DOMParser();
  const chapters = [];
  for (const { name, n } of chapterFiles) {
    const src = await zip.text(name);
    let doc = parser.parseFromString(src, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = parser.parseFromString(src, 'text/html');

    let blocks = [...doc.querySelectorAll('div.extract')];
    if (!blocks.length) blocks = [doc.body || doc.documentElement]; // fallback: whole chapter as one stanza

    const stanzas = blocks
      .map(b => [...b.querySelectorAll('p')]
        .map(p => p.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean))
      .filter(s => s.length);

    if (stanzas.length) chapters.push({ n, stanzas });
  }

  if (chapters.length < 81) {
    throw new Error(`Found ${chapters.length} chapters (expected 81). Is this the Mitchell EPUB?`);
  }
  return chapters;
}
