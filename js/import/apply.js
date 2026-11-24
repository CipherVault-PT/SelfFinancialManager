import { state, uid, snapshotForUndo, pruneAlerts } from '../store.js';
import { byQuote } from '../stocks.js';

const EPS = 1e-9;

/** Chaves que identificam o que já veio de um extrato (para não importar duas vezes); prefixo por corretora. */
const keysFor = (P = 'xtb') => ({
  open: r => `${P}o:${r.id}`,
  close: r => `${P}c:${r.id}@${r.closeTs}`,
  div: d => `${P}d:${d.id}`,
  closedPrefix: `${P}c:`,
});

const isManual = l => !l.src;

/** A mesma conta: mesma corretora e mesma moeda (a XTB tem uma conta em euros e outra em dólares). */
const sameAccount = (p, broker, currency) => p.platform === broker && p.kind === 'stock' && (p.currency || 'EUR') === currency;

const isinOf = p => p.isin || byQuote(p.quoteSymbol)?.i || null;

/** O mesmo ativo: mesmo símbolo do Yahoo ou, se o extrato tiver o ISIN, o mesmo ISIN (ex.: o ETF noutra bolsa). */
const sameAsset = (p, r) => (r.y && p.quoteSymbol === r.y) || (!!r.isin && isinOf(p) === r.isin);
const assetKey = r => r.y || r.isin;

function lotOf(r, src) {
  return { shares: r.units, cost: r.cost, priceQ: r.price > 0 ? r.price : null, priceCur: r.priceCur ?? r.quoteCur, date: r.date, src };
}

function reduceLot(lot, units) {
  const rest = lot.shares - units;
  if (rest <= lot.shares * 1e-9 + EPS) return null;
  return { ...lot, shares: rest, cost: lot.cost * (rest / lot.shares) };
}

/** Quantas entradas da corretora foram registadas à mão (candidatas a ser substituídas pelo extrato). */
export function manualCount(broker, stmt) {
  const T = stmt.snapshot, from = stmt.period?.from, cur = stmt.currency;
  const lots = !T ? 0 : state.positions
    .filter(p => sameAccount(p, broker, cur))
    .reduce((s, p) => s + p.lots.filter(l => isManual(l) && (!l.date || l.date <= T)).length, 0);
  const sales = state.closed.filter(c => manualSale(c, broker, cur, from, T)).length;
  return { lots, sales };
}

function manualSale(c, broker, cur, from, to) {
  return sameAccount(c, broker, cur) && c.lots.every(isManual)
    && !!from && !!to && !!c.closedAt && c.closedAt >= from && c.closedAt <= to;
}

/**
 * Prepara a importação sem mexer no estado: devolve as novas listas e um resumo para pré-visualizar.
 * `replace`: as entradas da mesma corretora registadas à mão (até à data do extrato) saem,
 * porque o extrato tem os valores exatos.
 */
export function planImport(stmt, { replace = true } = {}) {
  const broker = stmt.broker, K = keysFor(stmt.keyPrefix);
  const openKey = K.open, closeKey = K.close, divKey = K.div;
  const positions = structuredClone(state.positions), closed = structuredClone(state.closed);
  const dividends = structuredClone(state.dividends);
  const sum = {
    openLots: 0, newPositions: [], touched: new Set(), sales: 0, saleLots: 0, dividends: 0,
    skipped: 0, reduced: 0, removedLots: 0, removedSales: 0, removedPositions: [],
  };
  const keys = new Set([...positions, ...closed].flatMap(p => p.lots.map(l => l.src).filter(Boolean)));
  for (const d of dividends) if (d.src) keys.add(d.src);
  const closedIds = new Set([...keys].filter(k => k.startsWith(K.closedPrefix)).map(k => k.slice(K.closedPrefix.length, k.indexOf('@'))));

  const T = stmt.snapshot, from = stmt.period?.from;
  const mine = p => sameAccount(p, broker, stmt.currency);

  if (replace) {
    if (T) {
      for (const p of positions.filter(mine)) {
        const keep = p.lots.filter(l => !(isManual(l) && (!l.date || l.date <= T)));
        if (keep.length !== p.lots.length) { sum.removedLots += p.lots.length - keep.length; p.lots = keep; sum.touched.add(p.id); }
      }
    }
    for (let i = closed.length - 1; i >= 0; i--) {
      if (manualSale(closed[i], broker, stmt.currency, from, T ?? stmt.period?.to)) { closed.splice(i, 1); sum.removedSales++; }
    }
  }

  const newClosed = stmt.closed.filter(r => {
    if (keys.has(closeKey(r))) { sum.skipped++; return false; }
    return true;
  });
  for (const r of newClosed) {
    for (const p of positions.filter(mine)) {
      const i = p.lots.findIndex(l => l.src === openKey(r));
      if (i < 0) continue;
      const left = reduceLot(p.lots[i], r.units);
      if (left) p.lots[i] = left; else p.lots.splice(i, 1);
      sum.reduced++; sum.touched.add(p.id);
    }
  }

  const findOpen = r => positions.find(p => mine(p) && sameAsset(p, r));
  for (const r of stmt.open) {
    if (keys.has(openKey(r)) || closedIds.has(r.id)) { sum.skipped++; continue; }
    let p = findOpen(r);
    if (!p) {
      const last = r.lastPrice > 0 ? r.lastPrice : !r.y && r.price > 0 ? r.price : 0;
      p = {
        id: uid(), kind: 'stock', platform: broker, currency: stmt.currency, name: r.name, symbol: r.ticker,
        exchange: r.exchange ?? broker, quoteSymbol: r.y, quoteCur: r.quoteCur || r.priceCur || stmt.currency, lots: [], openedAt: r.date,
        ...(r.isin ? { isin: r.isin } : {}), ...(last > 0 ? { manualPrice: last } : {}),
      };
      positions.push(p);
      sum.newPositions.push(p.name);
    }
    p.lots.push(lotOf(r, openKey(r)));
    if (r.date && (!p.openedAt || r.date < p.openedAt)) p.openedAt = r.date;
    sum.openLots++; sum.touched.add(p.id);
  }

  const assetIds = new Map();
  const assetId = r => {
    const k = assetKey(r);
    if (!assetIds.has(k)) {
      const p = findOpen(r) ?? null;
      const c = closed.find(x => mine(x) && sameAsset(x, r));
      assetIds.set(k, p?.id ?? c?.parentId ?? c?.id ?? uid());
    }
    return assetIds.get(k);
  };

  const groups = new Map();
  for (const r of newClosed) {
    const k = `${assetKey(r)}|${r.closeTs}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const rows of groups.values()) {
    const r0 = rows[0];
    const units = rows.reduce((s, r) => s + r.units, 0);
    const exitValue = rows.reduce((s, r) => s + r.units * (r.closePrice || 0), 0);
    const lots = rows.map(r => lotOf(r, closeKey(r))).sort((a, b) => a.date.localeCompare(b.date));
    closed.push({
      id: uid(), parentId: assetId(r0), kind: 'stock', platform: broker, currency: stmt.currency,
      name: r0.name, symbol: r0.ticker, exchange: r0.exchange ?? broker, quoteSymbol: r0.y, quoteCur: r0.quoteCur || r0.priceCur || stmt.currency,
      ...(r0.isin ? { isin: r0.isin } : {}),
      lots, openedAt: lots[0].date, exitPrice: units > 0 && exitValue > 0 ? exitValue / units : null, exitCur: r0.priceCur ?? r0.quoteCur,
      proceeds: rows.reduce((s, r) => s + r.proceeds, 0), closedAt: r0.closeDate,
    });
    sum.sales++; sum.saleLots += rows.length;
  }
  closed.sort((a, b) => (a.closedAt || '').localeCompare(b.closedAt || ''));

  for (const d of stmt.dividends) {
    const dup = keys.has(divKey(d)) || dividends.some(x => !x.src && x.platform === broker && x.date === d.date
      && Math.abs(x.gross - d.gross) <= 0.01 + d.gross * 1e-3);
    if (dup) { sum.skipped++; continue; }
    dividends.push({
      id: uid(), posId: assetId(d), name: d.name, symbol: d.ticker, platform: broker, date: d.date,
      currency: stmt.currency, gross: d.gross, withheld: d.withheld, src: divKey(d),
    });
    sum.dividends++;
  }

  for (let i = positions.length - 1; i >= 0; i--) {
    if (mine(positions[i]) && sum.touched.has(positions[i].id) && !positions[i].lots.length) {
      sum.removedPositions.push(positions[i].name);
      positions.splice(i, 1);
    }
  }

  return {
    next: { positions, closed, dividends },
    summary: { ...sum, touched: sum.touched.size, changes: sum.openLots + sum.sales + sum.dividends + sum.removedLots + sum.removedSales + sum.reduced },
  };
}

/** Aplica um plano (guardando antes uma cópia para "Repor os dados de antes da importação"). */
export function applyImport(plan) {
  snapshotForUndo('import');
  state.positions = plan.next.positions;
  state.closed = plan.next.closed;
  state.dividends = plan.next.dividends;
  pruneAlerts();
}
