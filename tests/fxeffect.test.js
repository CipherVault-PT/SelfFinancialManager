import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { fxSplit, fxSummary, ensureLotFx } from '../js/fxeffect.js';
import { reset, stockPos, lot, mockFetch } from './helpers.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const usd = (extra = {}) => stockPos({ platform: 'Revolut', quoteSymbol: 'ZZA', symbol: 'ZZA', lots: [lot(10, 925, { priceQ: 100, priceCur: 'USD' })], ...extra });

test('câmbio: a ação subiu 10% em dólares, mas o dólar caiu — separa as duas partes', () => {
  reset(); // 1 € = 1,25 $
  state.positions = [usd()];
  state.cache.stockPrices.ZZA = { price: 110, cur: 'USD', dayPct: 0, ts: Date.now() };
  const s = fxSplit(state.positions[0]);
  close(s.pl, 880 - 925);
  close(s.price, (1100 - 1000) * 0.8, 1e-9);
  close(s.fx, -45 - 80);
  close(s.r0, 0.925);
  close(s.r1, 0.8);
  assert.equal(s.approx, false);
});

test('câmbio: a taxa de conversão da XTB entra no efeito do câmbio', () => {
  reset();
  state.positions = [usd({ platform: 'XTB' })];
  state.cache.stockPrices.ZZA = { price: 110, cur: 'USD', dayPct: 0, ts: Date.now() };
  const s = fxSplit(state.positions[0]);
  close(s.price, 80);
  close(s.fx, 880 * 0.995 - 925 - 80);
});

test('câmbio: sem preço em dólares, usa o câmbio do BCE no dia da compra (e vai buscá-lo se falta)', async () => {
  reset();
  state.positions = [usd({ lots: [lot(10, 925, { date: '2025-03-04' })] })];
  state.cache.stockPrices.ZZA = { price: 110, cur: 'USD', dayPct: 0, ts: Date.now() };
  assert.deepEqual(fxSplit(state.positions[0]), { missing: true, qc: 'USD', ac: 'EUR' });
  assert.equal(fxSummary().missing, 1);
  const calls = mockFetch([['frankfurter.app', { rates: { '2025-03-04': { USD: 1.08 } } }]]);
  assert.equal(await ensureLotFx(), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /USD/);
  const s = fxSplit(state.positions[0]);
  close(s.price, (1100 - 925 * 1.08) * 0.8);
  assert.equal(s.approx, true);
  assert.equal(await ensureLotFx(), false, 'já tem tudo');
});

test('câmbio: só ações cotadas noutra moeda e com cotação; totais por moeda', () => {
  reset();
  state.positions = [
    usd({ id: 'a' }),
    usd({ id: 'b', lots: [lot(5, 500, { priceQ: 125, priceCur: 'USD' })] }),
    stockPos({ id: 'c', quoteSymbol: 'ZZB.DE', quoteCur: 'EUR', lots: [lot(1, 100, { priceQ: 100, priceCur: 'EUR' })] }),
    { id: 'd', kind: 'crypto', platform: 'Revolut', currency: 'EUR', coingeckoId: 'zzcoin', lots: [lot(1, 100)] },
    usd({ id: 'e', quoteSymbol: 'ZZN' }),
  ];
  state.cache.stockPrices.ZZA = { price: 110, cur: 'USD', dayPct: 0, ts: Date.now() };
  state.cache.stockPrices['ZZB.DE'] = { price: 90, cur: 'EUR', dayPct: 0, ts: Date.now() };
  assert.equal(fxSplit(state.positions[2]), null, 'cota em euros');
  assert.equal(fxSplit(state.positions[4]), null, 'sem cotação');
  const f = fxSummary(state.positions, 'EUR');
  assert.equal(f.groups.length, 1);
  const g = f.groups[0];
  assert.equal(g.n, 2);
  close(g.costQ, 1000 + 625);
  close(g.r0, 1425 / 1625);
  close(g.price + g.fx, (1100 + 550) * 0.8 - 1425);
  close(g.move, (0.8 / (1425 / 1625) - 1) * 100);
  close(fxSummary(state.positions, 'USD').price, f.price * 1.25);
});
