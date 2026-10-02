import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { parseYahooSeries } from '../js/quotes/stocks.js';
import {
  xirr, shownRate, cashFlows, performance, priceOn, benchmarkCompare, ensureBenchmark, benchSeries, benchState,
  firstBuyDate, BENCHMARK, _resetBenchmark,
} from '../js/performance.js';
import { reset, lot, stockPos, mockFetch } from './helpers.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const pos = (extra = {}) =>
  stockPos({ platform: 'Revolut', quoteCur: 'EUR', quoteSymbol: null, lots: [lot(10, 1000, { date: '2024-01-01' })], manualPrice: 110, ...extra });

test('TIR: 10% num ano, sinais e casos sem solução', () => {
  near(xirr([{ d: '2024-01-01', v: -1000 }, { d: '2024-12-31', v: 1100 }]), 0.10);
  near(xirr([{ d: '2024-01-01', v: -1000 }, { d: '2024-12-31', v: 900 }]), -0.10);
  const two = xirr([{ d: '2023-01-01', v: -1000 }, { d: '2024-01-01', v: -1000 }, { d: '2025-01-01', v: 2310 }]);
  near(two, 0.10, 1e-3);
  assert.equal(xirr([{ d: '2024-01-01', v: -1000 }]), null);
  assert.equal(xirr([{ d: '2024-01-01', v: -1000 }, { d: '2024-06-01', v: -5 }]), null);
});

test('rentabilidade mostrada: nada antes de 30 dias, do período antes de 1 ano, anual depois', () => {
  assert.equal(shownRate(0.5, 10), null);
  near(shownRate(0.21, 182.5), Math.sqrt(1.21) - 1);
  assert.equal(shownRate(0.1, 400), 0.1);
  assert.equal(shownRate(null, 400), null);
});

test('carteira: compras, vendas e dividendos contam nas datas certas', () => {
  reset();
  state.positions = [pos()];
  state.closed = [{ ...pos({ id: 's1', lots: [lot(5, 500, { date: '2024-01-01' })] }), proceeds: 550, closedAt: '2024-07-01' }];
  state.dividends = [{ id: 'd', posId: 'p1', date: '2024-06-01', currency: 'USD', gross: 25, withheld: 0 }];
  const { flows } = cashFlows();
  assert.deepEqual(flows.map(f => [f.d, Math.round(f.v)]), [
    ['2024-01-01', -1000], ['2024-01-01', -500], ['2024-06-01', 20], ['2024-07-01', 550],
  ]);
  const pf = performance('2024-12-31');
  assert.equal(pf.start, '2024-01-01');
  assert.equal(pf.days, 365);
  near(pf.invested, 1500);
  near(pf.value, 1100);
  near(pf.gain, 1100 + 550 + 20 - 1500);
  near(pf.totalPct, (170 / 1500) * 100);
  assert.ok(pf.annual > 0.1 && pf.annual < 0.14, String(pf.annual));
  assert.equal(pf.rate, pf.annual);
  assert.equal(firstBuyDate(), '2024-01-01');
});

test('carteira: sem compras não há rentabilidade; entradas sem data usam o início da app', () => {
  reset();
  assert.equal(performance(), null);
  state.settings.createdAt = Date.parse('2024-03-01T12:00:00');
  state.positions = [pos({ lots: [lot(10, 1000, { date: '' })] })];
  const pf = performance('2024-03-20');
  assert.equal(pf.missingDates, 1);
  assert.equal(pf.start, '2024-03-01');
  assert.equal(pf.annual, null);
  assert.equal(pf.rate, null);
});

test('comparação: mesmo dinheiro, mesmas datas no ETF de referência', () => {
  const flows = [{ d: '2024-01-01', v: -1000 }, { d: '2024-07-01', v: -1000 }];
  const flat = [['2023-12-29', 50], ['2024-06-28', 50], ['2024-12-30', 50]];
  assert.equal(priceOn(flat, '2024-01-01'), 50);
  assert.equal(priceOn([['2024-02-01', 7]], '2024-01-01'), 7);
  const f = benchmarkCompare(flows, flat, '2024-12-31');
  near(f.value, 2000);
  near(f.rate, 0, 1e-6);
  const up = benchmarkCompare(flows, [['2024-01-01', 100], ['2024-07-01', 100], ['2024-12-31', 110]], '2024-12-31');
  near(up.value, 2200);
  assert.ok(up.rate > 0.1);
  assert.equal(benchmarkCompare(flows, null), null);
});

test('série do Yahoo: preço ajustado, pence → libras e pontos inválidos ignorados', () => {
  const t = s => Date.parse(`${s}T14:30:00Z`) / 1000;
  const d = {
    chart: { result: [{
      meta: { currency: 'GBp' },
      timestamp: [t('2024-01-02'), t('2024-01-03'), t('2024-01-04')],
      indicators: { quote: [{ close: [1, 2, 3] }], adjclose: [{ adjclose: [500, null, 520] }] },
    }] },
  };
  assert.deepEqual(parseYahooSeries(d), [['2024-01-02', 5], ['2024-01-04', 5.2]]);
  assert.equal(parseYahooSeries({ chart: { result: null } }), null);
});

test('ETF de referência: guarda a série, não repete pedidos e espera depois de falhar', async () => {
  reset();
  _resetBenchmark();
  const chart = { chart: { result: [{ meta: { currency: 'EUR' }, timestamp: [1704204000, 1735653600], indicators: { quote: [{ close: [480, 560] }] } }] } };
  let calls = mockFetch([['SXR8', chart]]);
  assert.equal(benchState(), 'idle');
  assert.equal(await ensureBenchmark('2024-01-15'), true);
  assert.equal(state.cache.bench.y, BENCHMARK.y);
  assert.equal(state.cache.bench.from, '2024-01-05');
  assert.deepEqual(benchSeries(), [['2024-01-02', 480], ['2024-12-31', 560]]);
  assert.equal(benchState(), 'ok');
  const n = calls.length;
  assert.equal(await ensureBenchmark('2024-02-01'), false);
  assert.equal(calls.length, n);

  reset();
  _resetBenchmark();
  calls = mockFetch([]);
  assert.equal(await ensureBenchmark('2024-01-15'), false);
  assert.equal(benchState(), 'fail');
  const after = calls.length;
  assert.equal(await ensureBenchmark('2024-01-15'), false);
  assert.equal(calls.length, after);
  state.cache.bench = { y: BENCHMARK.y, from: '2024-01-01', ts: Date.now(), points: 'lixo' };
  assert.equal(benchSeries(), null);
});
