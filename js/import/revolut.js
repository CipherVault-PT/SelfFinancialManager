import { parseCsv, csvObjects } from './csv.js';

/** Reconhece o extrato de cripto da Revolut (Symbol, Type, Quantity, Price, Value, Fees, Date). */
export const isRevolut = rows => ['symbol', 'type', 'quantity', 'price', 'value', 'fees', 'date']
  .every(k => (rows?.[0] ?? []).some(h => h.trim().toLowerCase() === k));

/** Desfaz texto codificado duas ou três vezes ("ReceÃ§Ã£o" → "Receção"), como sai nalguns extratos. */
export function fixText(s) {
  let out = String(s ?? '');
  for (let i = 0; i < 3 && /[ÃÂ]/.test(out) && [...out].every(c => c.charCodeAt(0) < 256); i++) {
    try { out = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(out, c => c.charCodeAt(0))); } catch { break; }
  }
  return out;
}

/** "12 345,67 €" → 12345.67 (separador de milhares com espaço; vírgula decimal). Ambíguo → NaN. */
export function euroNum(raw) {
  const s = String(raw ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return NaN;
  if ((s.match(/,/g)?.length ?? 0) > 1 || (s.includes(',') && s.includes('.'))) return NaN;
  return Number.parseFloat(s.replace(',', '.'));
}

/**
 * Quantidade de cripto. A exportação da Revolut perde a vírgula nas quantidades pequenas ("45,678" é 0,00045678):
 * quando o número não bate com valor ÷ preço, os algarismos são lidos na escala que bate.
 */
export function quantity(raw, value, price) {
  const n = euroNum(raw), want = price > 0 && value > 0 ? value / price : null;
  if (!want || (n > 0 && Math.abs(n / want - 1) < 0.05)) return n;
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits || !+digits) return n;
  let best = NaN;
  for (let k = 0; k <= 18; k++) {
    const c = +digits / 10 ** k;
    if (!(Math.abs(Math.log(c / want)) >= Math.abs(Math.log(best / want)))) best = c;
  }
  return best;
}

/** "07/08/2025, 09:15:00" → { date: '2025-08-07', at: '2025-08-07T09:15:00' }. */
function when(raw) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(raw ?? ''));
  if (!m) return null;
  const p = v => String(v ?? 0).padStart(2, '0');
  const date = `${m[3]}-${p(m[2])}-${p(m[1])}`;
  return { date, at: `${date}T${p(m[4])}:${p(m[5])}:${p(m[6])}` };
}

const kindOf = type => {
  const t = fixText(type).toLowerCase();
  if (/^(compra|comprar|buy|purchase)/.test(t)) return 'buy';
  if (/^(venda|vender|sell|sale)/.test(t)) return 'sell';
  if (/^(rece|receive|recompensa|reward|staking|airdrop|bónus|bonus)/.test(t)) return 'in';
  if (/^(envi|send|withdraw|levant)/.test(t)) return 'out';
  return null;
};

/**
 * Lê o extrato de cripto da Revolut e reconstrói as posições pelo FIFO. O custo inclui a comissão;
 * o valor de venda é líquido dela. Moedas recebidas (transferências, recompensas) entram pelo valor na data
 * em que chegaram (aproximado, com aviso); enviadas saem das posições sem contar como venda.
 * `modified`: data do ficheiro (dá a data do extrato, que o ficheiro não traz).
 */
export function parseRevolut(text, { modified = null } = {}) {
  const rows = parseCsv(text);
  if (!isRevolut(rows)) throw new Error('Não reconheci este extrato da Revolut.');
  const seen = new Map();
  const tx = csvObjects(rows).map(r => ({ ...r, w: when(r.date), sym: fixText(r.symbol).toUpperCase(), kind: kindOf(r.type) }))
    .filter(r => r.w && r.sym)
    .sort((a, b) => a.w.at.localeCompare(b.w.at));
  const out = {
    broker: 'Revolut', currency: 'EUR', kind: 'crypto', keyPrefix: 'rv',
    period: tx.length ? { from: tx[0].w.date, to: tx.at(-1).w.date } : null, snapshot: null,
    open: [], closed: [], dividends: [], cfd: { count: 0, pl: 0 }, interest: { gross: 0, tax: 0 },
    ignored: 0, sent: 0, missing: [], approx: [],
  };
  const fileDay = modified ? new Date(modified).toISOString().slice(0, 10) : null;
  out.snapshot = [out.period?.to, fileDay].filter(Boolean).sort().at(-1) ?? null;
  const lots = new Map();

  for (const r of tx) {
    if (r.sym === 'EUR' || !/^[A-Z0-9]{2,12}$/.test(r.sym)) continue;
    if (!r.kind) { out.ignored++; continue; }
    const price = euroNum(r.price), value = euroNum(r.value), fee = Math.abs(euroNum(r.fees)) || 0;
    const units = Math.abs(quantity(r.quantity, value, price));
    if (!(units > 0)) { out.ignored++; continue; }
    const key = `${r.sym}|${r.w.at}|${r.value}`, n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const id = n > 1 ? `${key}#${n}` : key;
    const list = lots.get(r.sym) ?? [];
    lots.set(r.sym, list);
    if (r.kind === 'buy' || r.kind === 'in') {
      const cost = (value > 0 ? value : units * (price || 0)) + (r.kind === 'buy' ? fee : 0);
      list.push({ id, symbol: r.sym, units, cost, price: price > 0 ? price : cost / units, date: r.w.date, approx: r.kind === 'in' });
      if (r.kind === 'in') out.approx.push({ symbol: r.sym, name: r.sym, units, cost, date: r.w.date });
      continue;
    }
    let left = units;
    const proceeds = Math.max((value > 0 ? value : 0) - fee, 0);
    while (left > units * 1e-6 && list.length) {
      const l = list[0], take = Math.min(left, l.units), share = take / l.units;
      if (r.kind === 'sell') {
        out.closed.push({
          id: l.id, symbol: r.sym, units: take, cost: l.cost * share, proceeds: proceeds * (take / units), price: l.price,
          date: l.date, closeTs: id, closeDate: r.w.date, closePrice: price > 0 ? price : null,
        });
      }
      l.cost -= l.cost * share; l.units -= take; left -= take;
      if (l.units <= 1e-12) list.shift();
    }
    if (r.kind === 'out') out.sent++;
    else if (left > units * 1e-6) out.missing.push({ symbol: r.sym, name: r.sym, units: left });
  }

  for (const list of lots.values()) for (const l of list) if (l.units > 1e-12) out.open.push({ ...l });
  for (const r of [...out.open, ...out.closed]) {
    Object.assign(r, { name: r.symbol, ticker: r.symbol, priceCur: 'EUR', quoteCur: 'EUR', y: null, coin: null, exchange: 'Revolut' });
  }
  return out;
}

/**
 * Id da CoinGecko de cada moeda: o que já usas na app para esse símbolo; senão a pesquisa da CoinGecko
 * (o resultado com o símbolo exato e maior capitalização).
 */
export async function resolveCoins(stmt, { known = {}, search }) {
  const syms = [...new Set([...stmt.open, ...stmt.closed].map(r => r.symbol))];
  const found = new Map();
  await Promise.all(syms.map(async sym => {
    if (known[sym]) { found.set(sym, known[sym]); return; }
    const res = await Promise.resolve().then(() => search(sym)).catch(() => []);
    const exact = (res ?? []).filter(c => String(c.symbol).toUpperCase() === sym)
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))[0];
    if (exact) found.set(sym, { id: exact.id, name: exact.name, thumb: exact.thumb });
  }));
  for (const r of [...stmt.open, ...stmt.closed]) {
    const c = found.get(r.symbol);
    if (c) Object.assign(r, { coin: c.id, name: c.name || r.name, thumb: c.thumb || r.thumb });
  }
  stmt.unresolved = syms.filter(s => !found.has(s));
  return stmt;
}
