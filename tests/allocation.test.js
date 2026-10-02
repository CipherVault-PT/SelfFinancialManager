import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { STOCKS } from '../js/stocks.js';
import { SECTORS, COUNTRIES, OVERRIDES } from '../js/data/classification.js';
import { autoClass, classify, allocation, concentration, unclassified, exposureCurrency, UNKNOWN } from '../js/allocation.js';
import { reset, lot, stockPos } from './helpers.js';

const pos = (y, extra = {}) => stockPos({ id: y || 'm', quoteSymbol: y, quoteCur: 'EUR', lots: [lot(1, 100)], manualPrice: 100, ...extra });

test('todas as ações da base têm setor e país válidos', () => {
  const known = new Set([...SECTORS]), countries = new Set(COUNTRIES);
  for (const s of STOCKS) {
    const c = autoClass({ kind: 'stock', quoteSymbol: s.y });
    assert.ok(known.has(c.sector), `${s.y}: setor ${c.sector}`);
    assert.ok(countries.has(c.country), `${s.y}: país ${c.country}`);
  }
  const ys = new Set(STOCKS.map(s => s.y));
  for (const [y, [sector, country]] of Object.entries(OVERRIDES)) {
    assert.ok(ys.has(y), `correção para símbolo inexistente: ${y}`);
    assert.ok(known.has(sector), `${y}: ${sector}`);
    if (country) assert.ok(countries.has(country), `${y}: ${country}`);
  }
});

test('classificação automática: EUA, Europa, ETFs, fora da base e cripto', () => {
  assert.deepEqual(autoClass(pos('AAPL')), { sector: 'Tecnologia', country: 'EUA' });
  assert.deepEqual(autoClass(pos('GALP.LS')), { sector: 'Energia', country: 'Portugal' });
  assert.deepEqual(autoClass(pos('DTE.DE')), { sector: 'Comunicações', country: 'Alemanha' });
  assert.deepEqual(autoClass(pos('STLAM.MI')), { sector: 'Consumo discric.', country: 'Países Baixos' });
  assert.deepEqual(autoClass(pos('VWCE.DE')), { sector: 'ETF (diversificado)', country: 'Global' });
  assert.deepEqual(autoClass(pos('SXR8.DE')), { sector: 'ETF (diversificado)', country: 'EUA' });
  assert.deepEqual(autoClass(pos('IS3N.DE')), { sector: 'ETF (diversificado)', country: 'Emergentes' });
  assert.deepEqual(autoClass(pos('TSM')), { sector: 'Tecnologia', country: 'Taiwan' });
  assert.deepEqual(autoClass(pos('XYZW.PA')), { sector: UNKNOWN, country: 'França' });
  assert.deepEqual(autoClass(pos(null)), { sector: UNKNOWN, country: UNKNOWN });
  assert.deepEqual(autoClass({ kind: 'crypto' }), { sector: 'Cripto', country: 'Cripto' });
  assert.deepEqual(classify(pos('XYZW.PA', { sector: 'Saúde', country: 'Suíça' })), { sector: 'Saúde', country: 'Suíça' });
});

test('distribuição por setor e por país: percentagens e "Sem dados" no fim', () => {
  reset();
  state.positions = [
    pos('AAPL', { lots: [lot(1, 100)], manualPrice: 600 }),
    pos('MSFT', { lots: [lot(1, 100)], manualPrice: 200 }),
    pos('GALP.LS', { lots: [lot(1, 100)], manualPrice: 100 }),
    pos(null, { name: 'Manual', lots: [lot(1, 100)], manualPrice: 100 }),
  ];
  const s = allocation('sector', 'EUR');
  assert.deepEqual(s.rows.map(r => [r.key, Math.round(r.pct)]), [['Tecnologia', 80], ['Energia', 10], [UNKNOWN, 10]]);
  assert.equal(Math.round(s.rows.reduce((a, r) => a + r.pct, 0)), 100);
  const c = allocation('country', 'EUR');
  assert.deepEqual(c.rows.map(r => r.key), ['EUA', 'Portugal', UNKNOWN]);
  assert.deepEqual(concentration(s), s.rows[0]);
  assert.deepEqual(unclassified().map(p => p.name), ['Manual']);
});

test('distribuição por moeda: moeda de cotação, cripto à parte e fundos incluídos', () => {
  reset();
  state.positions = [
    pos('AAPL', { quoteCur: 'USD', lots: [lot(1, 100)], manualPrice: 100 }),
    { id: 'c', kind: 'crypto', platform: 'Revolut', currency: 'EUR', coingeckoId: 'bitcoin', lots: [lot(1, 100)] },
  ];
  state.cache.stockPrices.AAPL = { price: 125, cur: 'USD', ts: Date.now() };
  state.cash = [{ id: 'k', label: 'F', currency: 'EUR', entries: [{ amount: 100, kind: 'deposit', date: '' }] }];
  assert.equal(exposureCurrency(state.positions[0]), 'USD');
  const m = allocation('currency', 'EUR');
  assert.deepEqual(m.rows.map(r => r.key).sort(), ['Cripto', 'EUR', 'USD']);
  assert.equal(concentration({ ...m, rows: m.rows.map(r => (r.key === 'USD' ? { ...r, pct: 50 } : r)) }).key, 'fora do euro');
});

test('ETFs e regiões não contam como concentração', () => {
  const al = { dim: 'sector', rows: [{ key: 'ETF (diversificado)', pct: 90 }, { key: 'Tecnologia', pct: 10 }] };
  assert.equal(concentration(al), null);
});
