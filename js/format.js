import { SYM } from './config.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const isCurrency = c => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
export const sym = c => SYM[c] ?? c;

const fmtCache = new Map();
function nf(cur, maxDigits) {
  const key = `${cur}|${maxDigits}`;
  if (!fmtCache.has(key)) {
    fmtCache.set(key, isCurrency(cur)
      ? new Intl.NumberFormat('pt-PT', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: maxDigits })
      : new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: maxDigits }));
  }
  return fmtCache.get(key);
}

const finite = v => (Number.isFinite(v) ? v : 0);

export function money(v, cur) {
  const s = nf(cur, 2).format(finite(v));
  return isCurrency(cur) ? s : `${s} ${cur ?? ''}`.trim();
}

/** Preço unitário: mais casas decimais para valores pequenos (ex: cripto). */
export function price(v, cur) {
  const n = finite(v);
  const digits = n !== 0 && Math.abs(n) < 1 ? 6 : 2;
  const s = nf(cur, digits).format(n);
  return isCurrency(cur) ? s : `${s} ${cur ?? ''}`.trim();
}

/** Partes de um montante para o número grande do topo (sem o símbolo da moeda). */
export function moneyParts(v, cur) {
  const parts = nf(cur, 2).formatToParts(finite(v));
  let int = '', dec = '';
  for (const p of parts) {
    if (p.type === 'minusSign' || p.type === 'integer' || p.type === 'group') int += p.value;
    else if (p.type === 'decimal' || p.type === 'fraction') dec += p.value;
  }
  return { int, dec, symbol: sym(cur) };
}

export function pct(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`;
}

export const signed = (v, s) => `${v >= 0 ? '+' : ''}${s}`;

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function units(v) {
  if (!Number.isFinite(v)) return '0';
  return v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

/** Data local (não UTC) no formato AAAA-MM-DD. */
export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Converte texto do utilizador em número, aceitando vírgula decimal. */
export function num(s) {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^-?\d*\.?\d+(e-?\d+)?$/i.test(norm) ? Number(norm) : NaN;
}

/** Formata um número para preencher um campo de texto (vírgula decimal). */
export function inputNum(v, maxDigits = 4) {
  if (!Number.isFinite(v)) return '';
  const digits = Math.abs(v) < 1 && v !== 0 ? 8 : maxDigits;
  return v.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}
