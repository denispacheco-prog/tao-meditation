// Minimal ZIP reader (enough for EPUB). No dependencies:
// uses the browser's DecompressionStream('deflate-raw').

export async function readZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  // Find "End of central directory" record (scan backwards).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP/EPUB file');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function text(name) {
    const e = entries.get(name);
    if (!e) return null;
    const lnameLen = view.getUint16(e.localOffset + 26, true);
    const lextraLen = view.getUint16(e.localOffset + 28, true);
    const start = e.localOffset + 30 + lnameLen + lextraLen;
    const data = bytes.subarray(start, start + e.compSize);
    if (e.method === 0) return decoder.decode(data);
    if (e.method !== 8) throw new Error('Unsupported compression in ' + name);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  return { names: [...entries.keys()], text };
}
