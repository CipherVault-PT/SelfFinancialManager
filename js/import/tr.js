import { STOCKS, currencyOfSymbol } from '../stocks.js';
import { parseCsv, csvObjects } from './csv.js';

const EPS = 1e-6;
const num = v => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const abs = v => Math.abs(num(v));
const dayBefore = iso => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Reconhece a exportação de transações da Trade Republic (CSV com ISIN e id de cada transação). */
export const isTr = rows => ['transaction_id', 'asset_class', 'symbol', 'shares', 'amount']
  .every(k => (rows?.[0] ?? []).some(h => h.trim().toLowerCase() === k));

const KIND = { STOCK: 'stock', FUND: 'etf', ETF: 'etf' };

/**
 * Lê as transações da Trade Republic e reconstrói as posições pelo FIFO (a regra do IRS):
 * compras (incluindo planos de poupança), vendas, dividendos e juros. O custo inclui a comissão e o imposto
 * de cada compra; o valor de venda é líquido deles. Os preços estão em euros (a TR negoceia em euros).
 * As migrações internas da TR (saída e entrada da mesma quantidade) não mexem na posição, mas dizem quantas
 * unidades havia: se o ficheiro começar depois das primeiras compras, a diferença entra como compra anterior
 * (custo pelo preço médio que a TR indica, data aproximada).
 * Nomes e IBAN das transferências não são lidos.
 */
export function parseTr(text, { name = '' } = {}) {
  const rows = parseCsv(text);
  if (!isTr(rows)) throw new Error('Não reconheci este ficheiro da Trade Republic.');
  const tx = csvObjects(rows).filter(r => r.date).sort((a, b) => (a.datetime || a.date).localeCompare(b.datetime || b.date));
  const m = /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/.exec(name);
  const period = m ? { from: m[1], to: m[2] } : tx.length ? { from: tx[0].date, to: tx.at(-1).date } : null;
  const out = {
    broker: 'Trade Republic', currency: tx.find(r => r.currency)?.currency || 'EUR', period, snapshot: period?.to ?? null,
    open: [], closed: [], dividends: [], cfd: { count: 0, pl: 0 }, interest: { gross: 0, tax: 0 },
    deposits: 0, withdrawals: 0, ignored: 0, missing: [], approx: [], keyPrefix: 'tr',
  };
  const lots = new Map(), info = new Map();
  const held = isin => (lots.get(isin) ?? []).reduce((s, l) => s + l.units, 0);
  const asset = r => {
    if (!info.has(r.symbol)) info.set(r.symbol, { isin: r.symbol, name: r.name || r.symbol, kind: KIND[r.asset_class] ?? 'stock' });
    return info.get(r.symbol);
  };

  for (let i = 0; i < tx.length; i++) {
    const r = tx[i], type = r.type.toUpperCase(), cat = r.category.toUpperCase();
    if (cat === 'TRADING' && (type === 'BUY' || type === 'SELL')) {
      if (!KIND[r.asset_class] || !r.symbol) { out.ignored++; continue; }
      const a = asset(r), units = abs(r.shares), price = num(r.price);
      if (!(units > 0)) continue;
      const fees = abs(r.fee) + abs(r.tax);
      if (type === 'BUY') {
        const list = lots.get(a.isin) ?? [];
        list.push({ id: r.transaction_id, isin: a.isin, units, cost: abs(r.amount) + fees, price, date: r.date });
        lots.set(a.isin, list);
        continue;
      }
      const proceeds = abs(r.amount) - fees;
      let left = units;
      const list = lots.get(a.isin) ?? [];
      while (left > units * EPS && list.length) {
        const l = list[0], take = Math.min(left, l.units), share = take / l.units;
        out.closed.push({
          id: l.id, isin: a.isin, units: take, cost: l.cost * share, proceeds: proceeds * (take / units), price: l.price,
          date: l.date, closeTs: r.transaction_id, closeDate: r.date, closePrice: price, approx: l.approx,
        });
        l.cost -= l.cost * share; l.units -= take; left -= take;
        if (l.units <= EPS) list.shift();
      }
      if (left > units * EPS) out.missing.push({ isin: a.isin, name: a.name, units: left });
    } else if (cat === 'DELIVERY' && type === 'MIGRATION') {
      // a TR regista a migração como saída e entrada da mesma quantidade, ao mesmo tempo
      const next = tx[i + 1], q = num(r.shares);
      if (next && next.symbol === r.symbol && next.type.toUpperCase() === 'MIGRATION' && Math.abs(num(next.shares) + q) <= Math.abs(q) * EPS) {
        i++;
        const a = asset(r), total = Math.abs(q), have = held(a.isin);
        if (total - have > total * 1e-4) {
          const units = total - have, known = (lots.get(a.isin) ?? []).reduce((s, l) => s + l.cost, 0);
          const cost = Math.max(total * num(r.price) - known, 0) || units * num(r.price);
          const lot = { id: `pre:${a.isin}`, isin: a.isin, units, cost, price: cost / units, date: dayBefore(period?.from ?? r.date), approx: true };
          lots.set(a.isin, [lot, ...(lots.get(a.isin) ?? [])]);
          out.approx.push({ isin: a.isin, name: a.name, units, cost });
        }
      } else out.ignored++;
    } else if (cat === 'CASH' || cat === '') {
      const amount = num(r.amount);
      if (type === 'INTEREST_PAYMENT') { out.interest.gross += amount + abs(r.tax); out.interest.tax += abs(r.tax); }
      else if (type.startsWith('DIVIDEND') && r.symbol && amount > 0) {
        const a = asset(r), tax = abs(r.tax);
        out.dividends.push({ id: r.transaction_id, isin: a.isin, date: r.date, gross: amount + tax, withheld: tax });
      } else if (type.endsWith('_INBOUND')) out.deposits += amount;
      else if (type.endsWith('_OUTBOUND')) out.withdrawals -= amount;
    } else if (r.symbol) out.ignored++;
  }

  for (const list of lots.values()) {
    for (const l of list) if (l.units > EPS) out.open.push({ ...l });
  }
  for (const r of [...out.open, ...out.closed, ...out.dividends]) {
    const a = info.get(r.isin);
    Object.assign(r, { name: a.name, kind: a.kind, priceCur: 'EUR', y: null, ticker: a.isin, quoteCur: null, exchange: 'Trade Republic' });
  }
  return out;
}

const EUR_SUFFIX = ['.DE', '.F', '.AS', '.PA', '.MI', '.LS', '.MC', '.BR', '.VI', '.HE', '.IR'];
const HOME = { PT: '.LS', DE: '.DE', NL: '.AS', FR: '.PA', IT: '.MI', ES: '.MC', BE: '.BR', AT: '.VI', FI: '.HE' };

/** A melhor cotação para um ISIN: a da bolsa dos EUA para ações americanas; senão a de casa ou a da Xetra, em euros. */
export function pickListing(isin, candidates) {
  const list = candidates.filter(c => c?.y && !c.y.toUpperCase().includes(isin));
  if (!list.length) return null;
  const suffix = y => /\.[A-Z]{1,3}$/.exec(y)?.[0] ?? '';
  const order = [HOME[isin.slice(0, 2)], ...EUR_SUFFIX].filter(Boolean);
  const rank = c => {
    const s = suffix(c.y);
    if (isin.startsWith('US')) return s ? 50 : 0;
    const i = order.indexOf(s);
    return i >= 0 ? i + 1 : 40;
  };
  return [...list].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Encontra o símbolo do Yahoo de cada ISIN: primeiro na base local (ETFs principais, com ISIN),
 * depois com `search(isin)` (pesquisa do Yahoo). Os que não encontrar ficam com preço à mão.
 */
export async function resolveIsins(stmt, search) {
  const isins = [...new Set([...stmt.open, ...stmt.closed, ...stmt.dividends].map(r => r.isin))];
  const found = new Map();
  await Promise.all(isins.map(async isin => {
    const local = STOCKS.filter(s => s.i === isin).map(s => ({ ...s, local: true }));
    const online = local.length ? [] : await Promise.resolve().then(() => search(isin)).catch(() => []);
    found.set(isin, pickListing(isin, [...local, ...(online ?? [])]));
  }));
  for (const r of [...stmt.open, ...stmt.closed, ...stmt.dividends]) {
    const s = found.get(r.isin);
    if (!s) continue;
    Object.assign(r, {
      y: s.y, ticker: s.t || s.y.replace(/\.[A-Z]{1,3}$/, ''), quoteCur: s.c || currencyOfSymbol(s.y),
      exchange: s.local ? s.x : r.exchange, name: s.local ? s.n : r.name,
    });
  }
  stmt.unresolved = [...new Set([...stmt.open, ...stmt.closed].filter(r => !r.y).map(r => r.name))];
  return stmt;
}
