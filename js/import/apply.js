import { state, uid, snapshotForUndo, pruneAlerts } from '../store.js';

const EPS = 1e-9;

/** Chaves que identificam o que já veio de um extrato (para não importar duas vezes). */
const openKey = r => `xtbo:${r.id}`;
const closeKey = r => `xtbc:${r.id}@${r.closeTs}`;
const divKey = d => `xtbd:${d.id}`;

const isManual = l => !l.src;

function lotOf(r, src) {
  return { shares: r.units, cost: r.cost, priceQ: r.price > 0 ? r.price : null, priceCur: r.quoteCur, date: r.date, src };
}

function reduceLot(lot, units) {
  const rest = lot.shares - units;
  if (rest <= lot.shares * 1e-9 + EPS) return null;
  return { ...lot, shares: rest, cost: lot.cost * (rest / lot.shares) };
}

/** Quantas entradas da corretora foram registadas à mão (candidatas a ser substituídas pelo extrato). */
export function manualCount(broker, stmt) {
  const T = stmt.snapshot, from = stmt.period?.from;
  const lots = !T ? 0 : state.positions
    .filter(p => p.platform === broker && p.kind === 'stock')
    .reduce((s, p) => s + p.lots.filter(l => isManual(l) && (!l.date || l.date <= T)).length, 0);
  const sales = state.closed.filter(c => manualSale(c, broker, from, T)).length;
  return { lots, sales };
}

function manualSale(c, broker, from, to) {
  return c.platform === broker && c.kind === 'stock' && c.lots.every(isManual)
    && !!from && !!to && !!c.closedAt && c.closedAt >= from && c.closedAt <= to;
}

/**
 * Prepara a importação sem mexer no estado: devolve as novas listas e um resumo para pré-visualizar.
 * `replace`: as entradas da mesma corretora registadas à mão (até à data do extrato) saem,
 * porque o extrato tem os valores exatos.
 */
export function planImport(stmt, { replace = true } = {}) {
  const broker = stmt.broker;
  const positions = structuredClone(state.positions), closed = structuredClone(state.closed);
  const dividends = structuredClone(state.dividends);
  const sum = {
    openLots: 0, newPositions: [], touched: new Set(), sales: 0, saleLots: 0, dividends: 0,
    skipped: 0, reduced: 0, removedLots: 0, removedSales: 0, removedPositions: [],
  };
  const keys = new Set([...positions, ...closed].flatMap(p => p.lots.map(l => l.src).filter(Boolean)));
  for (const d of dividends) if (d.src) keys.add(d.src);
  const closedIds = new Set([...keys].filter(k => k.startsWith('xtbc:')).map(k => k.slice(5, k.indexOf('@'))));

  const T = stmt.snapshot, from = stmt.period?.from;
  const mine = p => p.platform === broker && p.kind === 'stock';

  if (replace) {
    if (T) {
      for (const p of positions.filter(mine)) {
        const keep = p.lots.filter(l => !(isManual(l) && (!l.date || l.date <= T)));
        if (keep.length !== p.lots.length) { sum.removedLots += p.lots.length - keep.length; p.lots = keep; sum.touched.add(p.id); }
      }
    }
    for (let i = closed.length - 1; i >= 0; i--) {
      if (manualSale(closed[i], broker, from, T ?? stmt.period?.to)) { closed.splice(i, 1); sum.removedSales++; }
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

  const findOpen = y => positions.find(p => mine(p) && p.quoteSymbol === y);
  for (const r of stmt.open) {
    if (keys.has(openKey(r)) || closedIds.has(r.id)) { sum.skipped++; continue; }
    let p = findOpen(r.y);
    if (!p) {
      p = {
        id: uid(), kind: 'stock', platform: broker, currency: stmt.currency, name: r.name, symbol: r.ticker,
        exchange: r.exchange ?? broker, quoteSymbol: r.y, quoteCur: r.quoteCur, lots: [], openedAt: r.date,
        ...(r.lastPrice > 0 ? { manualPrice: r.lastPrice } : {}),
      };
      positions.push(p);
      sum.newPositions.push(p.name);
    }
    p.lots.push(lotOf(r, openKey(r)));
    if (r.date && (!p.openedAt || r.date < p.openedAt)) p.openedAt = r.date;
    sum.openLots++; sum.touched.add(p.id);
  }

  const assetIds = new Map();
  const assetId = y => {
    if (!assetIds.has(y)) {
      const p = findOpen(y) ?? null;
      const c = closed.find(x => mine(x) && x.quoteSymbol === y);
      assetIds.set(y, p?.id ?? c?.parentId ?? c?.id ?? uid());
    }
    return assetIds.get(y);
  };

  const groups = new Map();
  for (const r of newClosed) {
    const k = `${r.y}|${r.closeTs}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const rows of groups.values()) {
    const r0 = rows[0];
    const units = rows.reduce((s, r) => s + r.units, 0);
    const exitValue = rows.reduce((s, r) => s + r.units * (r.closePrice || 0), 0);
    const lots = rows.map(r => lotOf(r, closeKey(r))).sort((a, b) => a.date.localeCompare(b.date));
    closed.push({
      id: uid(), parentId: assetId(r0.y), kind: 'stock', platform: broker, currency: stmt.currency,
      name: r0.name, symbol: r0.ticker, exchange: r0.exchange ?? broker, quoteSymbol: r0.y, quoteCur: r0.quoteCur,
      lots, openedAt: lots[0].date, exitPrice: units > 0 && exitValue > 0 ? exitValue / units : null, exitCur: r0.quoteCur,
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
      id: uid(), posId: assetId(d.y), name: d.name, symbol: d.ticker, platform: broker, date: d.date,
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
