import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate, importJSON, exportJSON, wipe } from '../js/store.js';
import { reset } from './helpers.js';

const legacy = () => ({
  positions: [
    { id: 'a', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Deutsche Telekom', symbol: 'DTE', exchange: 'Xetra', lots: [{ shares: 5, cost: 150, date: '2025-01-01' }] },
    { id: 'b', kind: 'stock', platform: 'Revolut', currency: 'EUR', name: 'Banco Santander', symbol: 'SAN.MC', exchange: 'Madrid', invested: 100, entryPrice: 5 },
    { id: 'c', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Berkshire', symbol: 'BRK.B', exchange: 'Financeiro', lots: [{ shares: 1, cost: 400 }] },
    { id: 'd', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Coisa', symbol: 'XPTO', lots: [{ shares: 1, cost: 10 }] },
    { id: 'e', kind: 'crypto', platform: 'Revolut', currency: 'EUR', name: 'Bitcoin', symbol: 'BTC', coingeckoId: 'bitcoin', lots: [{ shares: 0.01, cost: 500 }] },
  ],
  closed: [],
  cash: [{ id: 'k', label: 'Emergência', currency: 'EUR', amount: 1000, date: '2025-01-01' }],
  alerts: [{ id: 'x', posId: 'a', cur: 'EUR', above: true, price: 40, active: true }, { id: 'y', posId: 'gone', cur: 'EUR', above: true, price: 1, active: true }],
  history: [{ d: '2025-01-01', v: 117 }],
  settings: { displayCurrency: 'USD' },
  cache: { rates: { USD: 1.17 }, stockPrices: { DTE: { price: 200, cur: 'USD' } } },
});

test('migração v1: símbolos Yahoo únicos para tickers repetidos', () => {
  hydrate(legacy());
  const q = Object.fromEntries(state.positions.map(p => [p.id, p.quoteSymbol]));
  assert.equal(q.a, 'DTE.DE');
  assert.equal(q.b, 'SAN.MC');
  assert.equal(q.c, 'BRK-B');
  assert.equal(q.d, 'XPTO');
  assert.equal(state.positions[0].quoteCur, 'EUR');
  assert.deepEqual(state.cache.stockPrices, {}, 'cotações antigas (indexadas por ticker) são descartadas');
});

test('migração v1: formatos antigos de posição, fundo, histórico e alertas', () => {
  hydrate(legacy());
  assert.deepEqual(state.positions[1].lots.map(l => [l.shares, l.cost]), [[20, 100]]);
  assert.equal(state.cash[0].entries[0].amount, 1000);
  assert.ok(Math.abs(state.history[0].v - 100) < 1e-9, 'histórico em USD convertido para EUR');
  assert.deepEqual(state.alerts.map(a => a.id), ['x'], 'alertas órfãos removidos');
  assert.equal(state.version, 2);
});

test('exportar e importar mantém alertas e histórico', () => {
  hydrate(legacy());
  const json = exportJSON();
  assert.ok(!JSON.parse(json).cache, 'a cache não vai no backup');
  wipe();
  assert.equal(state.positions.length + state.alerts.length + state.history.length, 0);
  importJSON(json);
  assert.equal(state.positions.length, 5);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].v, legacy().history[0].v / 1.17, 'um backup v2 não é convertido outra vez');
});

test('importar rejeita ficheiros sem posições', () => {
  reset();
  assert.throws(() => importJSON('{"foo":1}'));
  assert.throws(() => importJSON('não é json'));
});
