/**
 * Leitor mínimo de .xlsx (zip + XML), sem bibliotecas externas: lê os valores das células
 * de cada folha. Chega para extratos de corretoras; não lê fórmulas nem formatação.
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lê os ficheiros de um zip: { caminho: Uint8Array }. */
export async function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Não é um ficheiro Excel (.xlsx) válido');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = {};
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('Ficheiro Excel danificado');
    const method = u16(b, p + 10), size = u32(b, p + 20);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (u32(b, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = await inflate(raw);
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescape(m[1])).join('');

/** Coluna "AB" → índice 27 (A = 0). */
export function colIndex(ref) {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Linhas de uma folha: [[valor, …], …] — números como número, o resto como texto. */
export function parseSheet(xml, shared = []) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = +attr(rm[1], 'r') || rows.length + 1;
    const cells = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1], body = cm[2] ?? '';
      const ref = attr(tag, 'r'), t = attr(tag, 't');
      const idx = ref ? colIndex(ref) : cells.length;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val;
      if (t === 'inlineStr') val = texts(body);
      else if (t === 's') val = shared[+v] ?? '';
      else if (t === 'str' || t === 'e') val = v != null ? unescape(v) : '';
      else if (t === 'b') val = v === '1';
      else val = v != null && v !== '' ? +v : '';
      if (val !== '' && val != null) cells[idx] = val;
    }
    rows[r - 1] = cells;
  }
  return Array.from(rows, r => r ?? []);
}

/** Lê um .xlsx: { "Nome da folha": linhas }. */
export async function readXlsx(buf) {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const text = p => (files[p] ? dec.decode(files[p]) : '');
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('Não é um ficheiro Excel (.xlsx) válido');
  const rels = {};
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
    if (id && target) rels[id] = target.replace(/^\/?(xl\/)?/, 'xl/');
  }
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(attr(m[0], 'name') ?? '').trim();
    const target = rels[attr(m[0], 'r:id')];
    if (name && target && files[target]) out[name] = parseSheet(text(target), shared);
  }
  return out;
}

/** Data/hora do Excel (dias desde 1899-12-30) → "AAAA-MM-DD". */
export function excelDate(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return '';
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}
