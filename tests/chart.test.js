import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGES, chartUrl, parseChart, lastDay, fetchChart } from '../js/quotes/chart.js';
import { reset, mockFetch } from './helpers.js';

const at = s => Date.parse(s);
const params = u => Object.fromEntries(new URL(u).searchParams);
const series = (pts, meta = {}) => ({ chart: { result: [{ meta: { currency: 'USD', ...meta }, timestamp: pts.map(p => at(p[0]) / 1000), indicators: { quote: [{ close: pts.map(p => p[1]) }] } }], error: null } });

test('gráfico: do minuto (1D) ao mês (Máx)', () => {
  assert.deepEqual(RANGES.map(r => r.label), ['1D', '1S', '1M', '6M', '1A', '5A', 'Máx']);
  const now = at('2026-11-04T17:00:00Z');
  assert.deepEqual(params(chartUrl('ZZA', '1y', now)), { interval: '1d', range: '1y' });
  assert.deepEqual(params(chartUrl('ZZA', 'max', now)), { interval: '1mo', range: 'max' });
});

test('gráfico 1D: a sessão de hoje com pré e pós-mercado nos EUA; antes de começar, a anterior', () => {
  const p = params(chartUrl('ZZA', '1d', at('2026-11-04T17:00:00Z')));
  assert.equal(p.interval, '1m');
  assert.equal(p.includePrePost, 'true');
  assert.equal(+p.period1 * 1000, at('2026-11-04T09:00:00Z'), 'pré-mercado às 4:00 de Nova Iorque');
  assert.equal(+p.period2 * 1000, at('2026-11-04T17:00:00Z'));
  const early = params(chartUrl('ZZA', '1d', at('2026-11-04T07:00:00Z')));
  assert.equal(+early.period1 * 1000, at('2026-11-03T09:00:00Z'), 'antes das 4:00 de NY: a sessão de ontem');
  assert.equal(+early.period2 * 1000, at('2026-11-04T01:00:00Z'), 'até ao fim do pós-mercado');
  const eu = params(chartUrl('ZZB.DE', '1d', at('2026-11-07T12:00:00Z')));
  assert.equal(+eu.period1 * 1000, at('2026-11-06T08:00:00Z'), 'sábado: a sessão de sexta da Xetra');
  assert.equal(eu.includePrePost, undefined);
  assert.deepEqual(params(chartUrl('ZZ=F', '1d')), { interval: '1m', range: '1d' }, 'sem bolsa conhecida');
});

test('gráfico: lê preços (pence → libras), ignora buracos e respostas estragadas', () => {
  const d = parseChart(series([['2026-11-04T09:00:00Z', 505], ['2026-11-04T09:01:00Z', null], ['2026-11-04T09:02:00Z', 510]], { currency: 'GBp', chartPreviousClose: 500 }));
  assert.equal(d.cur, 'GBP');
  assert.deepEqual(d.pts.map(p => p[1]), [5.05, 5.1]);
  assert.equal(d.prev, 5);
  assert.equal(parseChart({ chart: { result: null } }), null);
  assert.equal(parseChart(series([], { currency: '<b>' })), null);
});

test('gráfico 1D vazio (feriado ou a começar): usa o último dia com negócios', async () => {
  reset({ settings: { proxyUrl: 'https://w.test' } });
  const wide = series([['2026-11-02T20:55:00Z', 9], ['2026-11-03T14:30:00Z', 10], ['2026-11-03T20:55:00Z', 11]]);
  const calls = mockFetch([['w.test', url => (decodeURIComponent(url).includes('range=5d') ? wide : series([['2026-11-04T09:00:00Z', 12]]))]]);
  const d = await fetchChart('ZZC', '1d', at('2026-11-04T09:05:00Z'));
  assert.deepEqual(d.pts.map(p => p[1]), [10, 11]);
  assert.equal(d.prev, 9, 'referência: o fecho do dia anterior');
  assert.equal(calls.length, 2);
  await fetchChart('ZZC', '1d', at('2026-11-04T09:05:30Z'));
  assert.equal(calls.length, 2, 'um minuto em memória');
  assert.equal(await fetchChart('ZZD', '1y'), null, 'sem resposta válida');
  assert.deepEqual(lastDay({ pts: [[at('2026-11-03T15:00:00Z'), 1]], prev: 0.5, cur: 'USD' }, 'ZZA').prev, 0.5);
});
