import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGES, chartUrl, parseChart, lastDay, fetchChart, fetchCoinChart, coinChartUrl, klinesUrl, parseCoinChart, parseKlines } from '../js/quotes/chart.js';
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

const cg = n => ({ prices: Array.from({ length: n }, (_, i) => [1_700_000_000_000 + i * 3600_000, 100 + i]) });
const kl = (n, base = 50) => Array.from({ length: n }, (_, i) => [1_600_000_000_000 + i * 86_400_000, '0', '0', '0', String(base + i), '0']);

test('cripto: endereços da CoinGecko e da Binance; leitura dos preços', () => {
  assert.equal(coinChartUrl('zz-coin', 'EUR', '5d'), 'https://api.coingecko.com/api/v3/coins/zz-coin/market_chart?vs_currency=eur&days=7');
  assert.equal(klinesUrl('ZZCEUR', 'max'), 'https://api.binance.com/api/v3/klines?symbol=ZZCEUR&interval=1M&limit=1000');
  assert.deepEqual(parseCoinChart({ prices: [[1, 2], [2, null], [3, 4]] }, 'EUR').pts, [[1, 2], [3, 4]]);
  assert.equal(parseCoinChart({ prices: [[1, 2]] }, 'EUR'), null, 'um ponto não chega');
  const k = parseKlines(kl(3), 'EUR', 0.8);
  assert.deepEqual(k.pts.map(p => +p[1].toFixed(6)), [40, 40.8, 41.6]);
  assert.equal(k.approx, true);
  assert.equal(parseKlines({ code: -1121 }, 'EUR'), null);
});

test('cripto: até 1 ano na CoinGecko; se falhar (limite de pedidos), a Binance', async () => {
  reset();
  let calls = mockFetch([['coingecko', cg(30)]]);
  const d = await fetchCoinChart({ id: 'zz-coin', symbol: 'ZZC', cur: 'EUR' }, '1mo');
  assert.deepEqual([d.src, d.cur, d.pts.length, d.prev], ['coingecko', 'EUR', 30, null]);
  assert.equal(calls.length, 1);
  calls = mockFetch([['coingecko', { __status: 429 }], ['symbol=ZZCEUR', kl(288)]]);
  const b = await fetchCoinChart({ id: 'zz-coin', symbol: 'ZZC', cur: 'EUR' }, '1d');
  assert.deepEqual([b.src, b.approx, b.pts.length], ['binance', false, 288]);
});

test('cripto 5A/Máx: Binance no par da moeda; senão em dólares convertidos; sem Binance, o último ano', async () => {
  reset(); // 1 € = 1,25 $
  let calls = mockFetch([['symbol=ZZDEUR', { __status: 400 }], ['symbol=ZZDUSDT', kl(5, 100)]]);
  const d = await fetchCoinChart({ id: 'zz-d', symbol: 'ZZD', cur: 'EUR' }, '5y');
  assert.equal(d.approx, true);
  assert.equal(d.pts[0][1], 80);
  assert.ok(!calls.some(u => u.includes('coingecko')), 'a CoinGecko gratuita não dá 5 anos: nem pede');
  calls = mockFetch([['binance', { __status: 400 }], ['coingecko', cg(365)]]);
  const y = await fetchCoinChart({ id: 'zz-e', symbol: 'ZZE', cur: 'USD' }, 'max');
  assert.deepEqual([y.capped, y.src], [true, 'coingecko']);
  assert.match(calls.at(-1), /days=365/);
  mockFetch([]);
  assert.equal(await fetchCoinChart({ id: 'zz-f', symbol: 'ZZF', cur: 'EUR' }, '1y'), null, 'sem ligação');
});

