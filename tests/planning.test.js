import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate } from '../js/store.js';
import { nextMonth, firstDue, setPlan, stopPlan, plansDue, advancePlan, estimateUnits, plansMonthly, validPlan } from '../js/plans.js';
import { monthsToGoal, futureValue, monthlyNeeded, addMonths, fourPercentMonthly } from '../js/goals.js';
import { assetKey, holdings, suggest, activeTargets, currentAsTargets } from '../js/rebalance.js';
import { parseEcbSeries, inflationSince, realRate, ensureInflation, hicpSeries, _resetInflation } from '../js/inflation.js';
import { reset, lot, stockPos, mockFetch } from './helpers.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const pos = (id, y, value, extra = {}) =>
  stockPos({ id, quoteSymbol: y, name: y, platform: 'Trade Republic', quoteCur: 'EUR', lots: [lot(1, value)], manualPrice: value, ...extra });

/* ---------- planos ---------- */

test('planos: datas do mês seguinte, primeira data e dia máximo 28', () => {
  assert.equal(nextMonth('2026-01-15', 15), '2026-02-15');
  assert.equal(nextMonth('2026-12-02', 2), '2027-01-02');
  assert.equal(nextMonth('2026-01-28', 31), '2026-02-28');
  assert.equal(firstDue(20, '2026-10-15'), '2026-10-20');
  assert.equal(firstDue(15, '2026-10-15'), '2026-10-15', 'hoje ainda conta');
  assert.equal(firstDue(2, '2026-10-15'), '2026-11-02');
  assert.equal(firstDue(2, '2026-12-15'), '2027-01-02');
});

test('planos: aviso quando chega o dia, confirmar/saltar avança um mês', () => {
  reset();
  const a = pos('a', 'VWCE.DE', 100), b = pos('b', 'SXR8.DE', 100);
  state.positions = [a, b];
  setPlan(a, { amount: 100, day: 2, source: 'new' }, '2026-09-20');
  setPlan(b, { amount: 50, day: 25 }, '2026-10-01');
  assert.equal(a.plan.next, '2026-10-02');
  assert.deepEqual(plansDue('2026-10-01').map(x => x.p.id), []);
  assert.deepEqual(plansDue('2026-10-02').map(x => [x.p.id, x.date]), [['a', '2026-10-02']]);
  assert.deepEqual(plansDue('2026-11-03').map(x => [x.p.id, x.date]), [['a', '2026-10-02'], ['b', '2026-10-25']]);
  advancePlan(a);
  assert.equal(a.plan.next, '2026-11-02');
  setPlan(a, { amount: 150, day: 2 }, '2026-10-20');
  assert.equal(a.plan.next, '2026-11-02', 'mudar o valor não mexe na próxima data');
  setPlan(a, { amount: 150, day: 10 }, '2026-10-20');
  assert.equal(a.plan.next, '2026-11-10', 'mudar o dia recalcula');
  assert.equal(plansMonthly('EUR'), 200);
  stopPlan(a);
  assert.equal(a.plan, undefined);
  assert.equal(validPlan({ amount: 0, day: 2, next: '2026-01-02' }), false);
});

test('planos: unidades estimadas com a taxa de câmbio da corretora', () => {
  reset();
  const tr = pos('a', 'VWCE.DE', 100);
  near(estimateUnits(tr, 100, 125, 'EUR'), 0.8);
  const xtb = stockPos({ platform: 'XTB', currency: 'EUR' });
  near(estimateUnits(xtb, 100, 125, 'USD'), (125 * 0.995) / 125, 1e-9);
  assert.equal(estimateUnits(tr, 0, 125, 'EUR'), 0);
});

test('planos: guardados com a posição; planos inválidos são descartados', () => {
  hydrate({ version: 2, cash: [], closed: [], alerts: [], history: [], positions: [
    { ...pos('a', 'VWCE.DE', 100), plan: { amount: 100, day: 2, source: 'new', next: '2026-11-02' } },
    { ...pos('b', 'SXR8.DE', 100), plan: { amount: -5, day: 2, next: 'x' } },
  ] });
  assert.equal(state.positions[0].plan.amount, 100);
  assert.equal(state.positions[1].plan, undefined);
});

/* ---------- metas ---------- */

test('metas: meses até ao objetivo, valor futuro e quanto pôr por mês', () => {
  assert.equal(monthsToGoal({ now: 0, monthly: 100, rate: 0, target: 1200 }), 12);
  assert.equal(monthsToGoal({ now: 2000, monthly: 0, target: 1000 }), 0);
  assert.equal(monthsToGoal({ now: 0, monthly: 0, rate: 0, target: 1000 }), null);
  const m = monthsToGoal({ now: 10_000, monthly: 500, rate: 7, target: 100_000 });
  assert.ok(m > 100 && m < 130, String(m));
  near(futureValue({ now: 1000, monthly: 0, rate: 12, months: 12 }), 1120, 1e-6);
  const need = monthlyNeeded({ now: 10_000, rate: 7, target: 100_000, months: m });
  assert.ok(need <= 500 && need > 450, String(need));
  assert.equal(monthlyNeeded({ now: 200_000, rate: 7, target: 100_000, months: 12 }), 0);
  assert.equal(addMonths(14, new Date(2026, 9, 15)), '2027-12');
  assert.equal(fourPercentMonthly(300_000), 1000);
});

/* ---------- rebalanceamento ---------- */

test('rebalanceamento: junta o mesmo ativo de várias corretoras', () => {
  reset();
  state.positions = [pos('a', 'VWCE.DE', 600), pos('b', 'VWCE.DE', 200, { platform: 'XTB' }), pos('c', 'SXR8.DE', 200)];
  assert.equal(assetKey(state.positions[0]), 's:VWCE.DE');
  assert.equal(assetKey({ kind: 'crypto', coingeckoId: 'bitcoin' }), 'c:bitcoin');
  assert.deepEqual(holdings('EUR').map(h => [h.key, h.value]), [['s:VWCE.DE', 800], ['s:SXR8.DE', 200]]);
  assert.deepEqual(currentAsTargets(holdings('EUR')), { 's:VWCE.DE': 80, 's:SXR8.DE': 20 });
});

test('rebalanceamento: dinheiro novo vai primeiro para o que está abaixo do alvo', () => {
  const list = [{ key: 'a', name: 'A', value: 800 }, { key: 'b', name: 'B', value: 200 }];
  const s = suggest(list, { a: 50, b: 50 }, 200);
  assert.deepEqual(s.rows.map(r => [r.key, Math.round(r.pct), r.target, Math.round(r.buy)]), [['a', 80, 50, 0], ['b', 20, 50, 200]]);
  const big = suggest(list, { a: 50, b: 50 }, 1000);
  assert.deepEqual(big.rows.map(r => Math.round(r.buy)), [200, 800], 'fica 1000/1000 = 50/50');
  const over = suggest(list, { a: 70, b: 30 }, 100);
  assert.deepEqual(over.rows.map(r => Math.round(r.buy)), [0, 100]);
  const none = suggest(list, {}, 100);
  assert.equal(none.hasTargets, false);
  assert.deepEqual(none.rows.map(r => r.buy), [0, 0]);
  assert.deepEqual(activeTargets(list, { a: 30, b: 30, gone: 40 }), { a: 50, b: 50 }, 'normaliza e ignora ativos vendidos');
});

/* ---------- inflação ---------- */

const ecb = (start, values) => ({
  dataSets: [{ series: { '0:0:0:0:0:0': { observations: Object.fromEntries(values.map((v, i) => [String(i), [v, 0, 0]])) } } }],
  structure: { dimensions: { observation: [{ id: 'TIME_PERIOD', values: values.map((_, i) => {
    const [y, m] = start.split('-').map(Number), d = new Date(y, m - 1 + i, 1);
    return { id: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
  }) }] } },
});

test('inflação: lê a série do BCE e calcula a do período e a anual', () => {
  const pts = parseEcbSeries(ecb('2024-01', Array.from({ length: 25 }, (_, i) => 100 * 1.03 ** (i / 12))));
  assert.equal(pts.length, 25);
  assert.equal(pts[0][0], '2024-01');
  assert.equal(pts.at(-1)[0], '2026-01');
  const inf = inflationSince(pts, '2024-01-15');
  assert.equal(inf.months, 24);
  near(inf.annual, 0.03, 1e-9);
  near(inf.period, 1.03 ** 2 - 1, 1e-9);
  near(realRate(0.08, 400, inf), 1.08 / 1.03 - 1, 1e-9);
  near(realRate(0.05, 200, inf), 1.05 / 1.03 ** 2 - 1, 1e-9);
  assert.equal(realRate(null, 400, inf), null);
  assert.equal(inflationSince(pts, '2030-01-01'), null);
  assert.equal(parseEcbSeries({}), null);
});

test('inflação: guarda a série uma vez por semana e espera depois de falhar', async () => {
  reset();
  _resetInflation();
  const calls = mockFetch([['data-api.ecb.europa.eu', ecb('2025-01', [120, 121, 122])]]);
  assert.equal(await ensureInflation('2025-01-10'), true);
  assert.deepEqual(hicpSeries().map(p => p[0]), ['2025-01', '2025-02', '2025-03']);
  const n = calls.length;
  assert.equal(await ensureInflation('2025-02-01'), false);
  assert.equal(calls.length, n);
  reset();
  _resetInflation();
  mockFetch([]);
  assert.equal(await ensureInflation('2025-01-10'), false);
  assert.equal(hicpSeries(), null);
});
