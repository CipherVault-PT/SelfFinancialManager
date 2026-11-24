import { byQuote } from '../stocks.js';
import { excelDate } from './xlsx.js';

/** Sufixo da XTB → sufixo do Yahoo e moedas prováveis de cotação. */
const MARKETS = {
  US: ['', ['USD']], UK: ['.L', ['GBP', 'GBp', 'USD', 'EUR']], DE: ['.DE', ['EUR', 'USD']], PT: ['.LS', ['EUR']],
  FR: ['.PA', ['EUR']], NL: ['.AS', ['EUR', 'USD']], ES: ['.MC', ['EUR']], IT: ['.MI', ['EUR', 'USD']],
  BE: ['.BR', ['EUR']], AT: ['.VI', ['EUR']], FI: ['.HE', ['EUR']], IE: ['.IR', ['EUR']],
  CH: ['.SW', ['CHF', 'USD', 'EUR']], DK: ['.CO', ['DKK']], SE: ['.ST', ['SEK']], NO: ['.OL', ['NOK']],
  PL: ['.WA', ['PLN']], CZ: ['.PR', ['CZK']],
};

/** "EDP.PT" → { y: "EDP.LS", ticker: "EDP", market: "PT" }; CFDs (sem sufixo de bolsa) → null. */
export function xtbToYahoo(sym) {
  const m = /^(.+)\.([A-Z]{2})$/.exec(String(sym || '').trim().toUpperCase());
  if (!m || !MARKETS[m[2]]) return null;
  const [, base, market] = m;
  const yBase = market === 'US' ? base.replace(/\./g, '-') : base;
  return { y: yBase + MARKETS[market][0], ticker: base, market };
}

/**
 * Moeda de cotação pela relação entre o valor em ações e o valor pago na moeda da conta
 * (ex: 1,08 dólares por euro → USD). A base local, quando conhece a ação, tem a última palavra.
 */
export function guessQuoteCur(market, implied, rates, account = 'EUR') {
  const cands = MARKETS[market]?.[1] ?? ['EUR'];
  if (!(implied > 0)) return cands[0];
  const rate = c => (c === 'GBp' ? (rates.GBP || 0.86) * 100 : rates[c]) / (rates[account] || 1);
  let best = cands[0], err = Infinity;
  for (const c of cands) {
    const r = rate(c);
    const e = r > 0 ? Math.abs(Math.log(implied / r)) : Infinity;
    if (e < err) { best = c; err = e; }
  }
  return best;
}

const norm = s => String(s ?? '').trim().toLowerCase();

function findSheet(wb, prefix) {
  const k = Object.keys(wb).find(n => norm(n).startsWith(prefix));
  return k ? wb[k] : null;
}

/** Tabela a partir da linha de cabeçalho que contém todas as colunas pedidas. */
function table(rows, required) {
  if (!rows) return null;
  const h = rows.findIndex(r => required.every(c => r.some(x => norm(x) === c)));
  if (h < 0) return null;
  const col = {};
  rows[h].forEach((x, i) => { if (typeof x === 'string') col[norm(x)] = i; });
  const data = rows.slice(h + 1).filter(r => r.length && norm(r[col[required[0]]]) !== 'total' && r.some(x => x !== undefined && x !== ''));
  return { col, data, get: (r, name) => r[col[name]] };
}

/** Moeda da conta, no bloco de cabeçalho ("Currency" e o valor na linha de baixo). */
function accountCurrency(rows) {
  for (let i = 0; i < Math.min(rows?.length ?? 0, 20); i++) {
    const j = rows[i].findIndex(x => norm(x) === 'currency');
    const v = j >= 0 ? rows[i + 1]?.[j] : null;
    if (typeof v === 'string' && /^[A-Z]{3}$/.test(v.trim())) return v.trim();
  }
  return null;
}

function periodOf(rows) {
  for (const r of rows?.slice(0, 20) ?? []) {
    for (const x of r) {
      const m = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(String(x ?? ''));
      if (m) return { from: `${m[3]}-${m[2]}-${m[1]}`, to: `${m[6]}-${m[5]}-${m[4]}` };
    }
  }
  return null;
}

const num = v => (typeof v === 'number' ? v : Number.parseFloat(String(v ?? '').replace(',', '.')));

/** Reconhece um extrato da XTB (xStation → Histórico → Exportar para Excel). */
export const isXtb = wb => !!(findSheet(wb, 'cash operation history') || findSheet(wb, 'closed position history') || findSheet(wb, 'open position'));

/** Ação/ETF da XTB → símbolo do Yahoo, nome e moeda de cotação (a mesma em todo o extrato). */
function assets(rates, currency) {
  const curBySym = {};
  return (sym, units, price, value) => {
    const a = xtbToYahoo(sym);
    if (!a) return null;
    const db = byQuote(a.y);
    let cur = curBySym[a.y] ??= db?.c ?? guessQuoteCur(a.market, (units * price) / value, rates, currency);
    let px = price;
    if (cur === 'GBp') { cur = 'GBP'; px = price / 100; }
    return { ...a, name: db?.n ?? a.ticker, exchange: db?.x ?? null, quoteCur: cur, price: px, gbp: curBySym[a.y] === 'GBp' };
  };
}

/** Juros, dividendos e impostos retidos das operações de caixa (os dois formatos). */
function cashOps(rows, out, { type, time, sym, id }) {
  const divs = [], taxes = [];
  for (const r of rows) {
    const t = norm(type(r)), amount = num(r.amount), s = sym(r), date = excelDate(num(time(r)));
    if (!Number.isFinite(amount) || !date) continue;
    if (t.startsWith('free-funds interest') || t.startsWith('free funds interest')) {
      if (t.includes('tax')) out.interest.tax -= amount; else out.interest.gross += amount;
    } else if (t.startsWith('divid')) {
      if (s && amount > 0) divs.push({ id: String(id(r)), sym: s, date, gross: amount, withheld: 0 });
    } else if (s && (t.includes('withholding') || t === 'tax' || t.includes('wht'))) {
      taxes.push({ sym: s, date, amount: -amount });
    } else if (t === 'deposit') out.deposits = (out.deposits || 0) + amount;
  }
  for (const t of taxes) {
    const day = Date.parse(t.date);
    const d = divs
      .filter(x => x.sym === t.sym && Math.abs(Date.parse(x.date) - day) <= 3 * 86_400_000)
      .sort((x, y) => Math.abs(Date.parse(x.date) - day) - Math.abs(Date.parse(y.date) - day))[0];
    if (d) d.withheld = Math.max(0, d.withheld + t.amount);
  }
  for (const d of divs) {
    const a = xtbToYahoo(d.sym);
    if (!a) continue;
    const db = byQuote(a.y);
    out.dividends.push({ ...d, xtb: d.sym, y: a.y, ticker: a.ticker, name: db?.n ?? a.ticker, withheld: Math.min(d.withheld, d.gross) });
  }
}

/**
 * Lê o extrato da XTB: posições abertas, posições fechadas (cada compra com a sua data, custo
 * e valor de venda na moeda da conta) e dividendos. CFDs ficam de fora (só ações e ETFs reais).
 * Aceita o formato antigo ("Closed Position History"…) e o de 2026 ("Closed Positions", com "Ticker").
 */
export function parseXtb(wb, { rates = { EUR: 1, USD: 1.17, GBP: 0.86 } } = {}) {
  if (isNewXtb(wb)) return parseXtbNew(wb, rates);
  const openRows = findSheet(wb, 'open position'), closedRows = findSheet(wb, 'closed position history');
  const cashRows = findSheet(wb, 'cash operation history');
  const currency = accountCurrency(cashRows ?? closedRows ?? openRows ?? []) ?? 'EUR';
  const period = periodOf(cashRows) ?? periodOf(closedRows);
  const cfd = { count: 0, pl: 0 };
  const out = { broker: 'XTB', currency, period, snapshot: null, open: [], closed: [], dividends: [], cfd, interest: { gross: 0, tax: 0 } };

  const assetOf = assets(rates, currency);

  const op = table(openRows, ['position', 'symbol', 'volume', 'open time', 'open price', 'purchase value']);
  if (op) {
    const name = Object.keys(wb).find(n => norm(n).startsWith('open position')) ?? '';
    const m = /(\d{2})(\d{2})(\d{4})/.exec(name);
    const serial = openRows.slice(0, 15).flat().find(x => Number.isInteger(x) && x > 30000 && x < 80000);
    out.snapshot = m ? `${m[3]}-${m[2]}-${m[1]}` : excelDate(serial) || null;
    for (const r of op.data) {
      const units = num(op.get(r, 'volume')), price = num(op.get(r, 'open price')), cost = num(op.get(r, 'purchase value'));
      if (!(cost > 0) || norm(op.get(r, 'type')) === 'sell') {
        if (units > 0) cfd.count++;
        continue;
      }
      const a = assetOf(op.get(r, 'symbol'), units, price, cost);
      if (!a || !(units > 0)) continue;
      const mkt = num(op.get(r, 'market price'));
      out.open.push({
        id: String(op.get(r, 'position')), xtb: op.get(r, 'symbol'), ...a, units, cost,
        date: excelDate(num(op.get(r, 'open time'))), lastPrice: mkt > 0 ? (a.gbp ? mkt / 100 : mkt) : null,
      });
    }
  }

  const cl = table(closedRows, ['position', 'symbol', 'volume', 'open time', 'close time', 'purchase value', 'sale value']);
  if (cl) {
    for (const r of cl.data) {
      const units = num(cl.get(r, 'volume')), price = num(cl.get(r, 'open price')), cost = num(cl.get(r, 'purchase value'));
      const proceeds = num(cl.get(r, 'sale value'));
      if (!(cost > 0) || !(proceeds >= 0) || norm(cl.get(r, 'type')) === 'sell') {
        if (units > 0) { cfd.count++; cfd.pl += num(cl.get(r, 'gross p/l')) || 0; }
        continue;
      }
      const a = assetOf(cl.get(r, 'symbol'), units, price, cost);
      if (!a || !(units > 0)) continue;
      const closeTs = num(cl.get(r, 'close time')), cp = num(cl.get(r, 'close price'));
      out.closed.push({
        id: String(cl.get(r, 'position')), xtb: cl.get(r, 'symbol'), ...a, units, cost, proceeds,
        date: excelDate(num(cl.get(r, 'open time'))), closeTs: String(closeTs), closeDate: excelDate(closeTs),
        closePrice: cp > 0 ? (a.gbp ? cp / 100 : cp) : null,
      });
    }
  }

  const ca = table(cashRows, ['id', 'type', 'time', 'amount']);
  if (ca) {
    cashOps(ca.data.map(r => ({ r, amount: ca.get(r, 'amount') })), out, {
      type: x => ca.get(x.r, 'type'), time: x => ca.get(x.r, 'time'), sym: x => ca.get(x.r, 'symbol'), id: x => ca.get(x.r, 'id'),
    });
  }

  if (!op && !cl && !ca) throw new Error('Não encontrei as folhas do extrato da XTB');
  return out;
}

/* ---------- formato de 2026 ---------- */

const isNewXtb = wb => [findSheet(wb, 'closed position'), findSheet(wb, 'open position')]
  .some(rows => rows?.slice(0, 15).some(r => r.some(x => norm(x) === 'ticker')));

/** Valor numa linha de cabeçalho do tipo ["Date from (UTC)", 46023]. */
const metaOf = (rows, label) => rows?.slice(0, 12).find(r => norm(r[0]) === label)?.[1];

function parseXtbNew(wb, rates) {
  const openRows = findSheet(wb, 'open position'), closedRows = findSheet(wb, 'closed position');
  const cashRows = findSheet(wb, 'cash operation');
  const currency = openRows?.slice(0, 12).find(r => norm(r[1]) === 'open position value')?.[3] ?? 'EUR';
  const from = excelDate(num(metaOf(closedRows ?? cashRows, 'date from (utc)')));
  const to = excelDate(num(metaOf(closedRows ?? cashRows, 'date to (utc)')));
  const cfd = { count: 0, pl: 0 };
  const out = {
    broker: 'XTB', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR', period: from && to ? { from, to } : null,
    snapshot: excelDate(num(metaOf(openRows, 'data as of report generated'))) || to || null,
    open: [], closed: [], dividends: [], cfd, interest: { gross: 0, tax: 0 },
  };
  const assetOf = assets(rates, out.currency);
  const real = c => c === 'stock' || c === 'etf';

  const op = table(openRows, ['instrument/position', 'ticker', 'type', 'volume', 'open price', 'open time (utc)']);
  if (op) {
    let category = '';
    for (const r of op.data) {
      const type = norm(op.get(r, 'type'));
      if (!type) { category = norm(op.get(r, 'category')); continue; } // linha de resumo de cada ação
      const units = num(op.get(r, 'volume')), price = num(op.get(r, 'open price')), value = num(op.get(r, 'value'));
      const gross = num(op.get(r, 'gross profit')), cost = value - (Number.isFinite(gross) ? gross : num(op.get(r, 'net profit')));
      if (type !== 'buy' || !real(category) || !(cost > 0)) { if (units > 0) cfd.count++; continue; }
      const a = assetOf(op.get(r, 'ticker'), units, price, cost);
      if (!a || !(units > 0)) continue;
      const mkt = num(op.get(r, 'current price'));
      out.open.push({
        id: String(op.get(r, 'instrument/position')), xtb: op.get(r, 'ticker'), ...a, units, cost,
        date: excelDate(num(op.get(r, 'open time (utc)'))), lastPrice: mkt > 0 ? (a.gbp ? mkt / 100 : mkt) : null,
      });
    }
  }

  const cl = table(closedRows, ['ticker', 'type', 'volume', 'open time (utc)', 'close time (utc)', 'purchase value', 'sale value', 'position id']);
  if (cl) {
    for (const r of cl.data) {
      const units = num(cl.get(r, 'volume')), price = num(cl.get(r, 'open price')), cost = num(cl.get(r, 'purchase value'));
      const proceeds = num(cl.get(r, 'sale value'));
      if (!cl.get(r, 'ticker')) continue; // total
      if (!real(norm(cl.get(r, 'category'))) || norm(cl.get(r, 'type')) !== 'buy' || !(cost > 0) || !(proceeds >= 0)) {
        if (units > 0) { cfd.count++; cfd.pl += num(cl.get(r, 'gross profit')) || 0; }
        continue;
      }
      const a = assetOf(cl.get(r, 'ticker'), units, price, cost);
      if (!a || !(units > 0)) continue;
      const closeTs = num(cl.get(r, 'close time (utc)')), cp = num(cl.get(r, 'close price'));
      out.closed.push({
        id: String(cl.get(r, 'position id')), xtb: cl.get(r, 'ticker'), ...a, units, cost, proceeds,
        date: excelDate(num(cl.get(r, 'open time (utc)'))), closeTs: String(closeTs), closeDate: excelDate(closeTs),
        closePrice: cp > 0 ? (a.gbp ? cp / 100 : cp) : null,
      });
    }
  }

  const ca = table(cashRows, ['type', 'ticker', 'time', 'amount', 'id']);
  if (ca) {
    cashOps(ca.data.map(r => ({ r, amount: ca.get(r, 'amount') })), out, {
      type: x => ca.get(x.r, 'type'), time: x => ca.get(x.r, 'time'), sym: x => ca.get(x.r, 'ticker'), id: x => ca.get(x.r, 'id'),
    });
  }
  if (!op && !cl && !ca) throw new Error('Não encontrei as folhas do extrato da XTB');
  return out;
}

