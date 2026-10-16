import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { MARKETS, easter, marketOf, marketStatus, sessionOn, isTradingDay, noteSession, extFromChart, extQuote, marketsHeld, zoned, extRows, trackedIndex, futuresWanted, futuresTime, futureQuote } from '../js/markets.js';
import { fetchFutures } from '../js/quotes/stocks.js';
import { parseYahooChart } from '../js/quotes/stocks.js';
import { reset, stockPos, lot, mockFetch } from './helpers.js';

const at = s => Date.parse(s);
const hhmm = ts => new Date(ts).toISOString().slice(11, 16);

test('mercados: Páscoa e feriados da bolsa de Nova Iorque e de Londres', () => {
  assert.deepEqual([2025, 2026, 2027].map(easter), ['2025-04-20', '2026-04-05', '2027-03-28']);
  assert.deepEqual(MARKETS.us.hol(2026), ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
  assert.ok(!MARKETS.us.hol(2022).includes('2021-12-31'), 'ano novo ao sábado não fecha a 31 de dezembro');
  assert.ok(MARKETS.us.hol(2027).includes('2027-12-24'), 'Natal ao sábado → sexta');
  assert.deepEqual(MARKETS.lse.hol(2026), ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
  assert.ok(MARKETS.stockholm.hol(2026).includes('2026-06-19'), 'véspera de São João');
  assert.equal(isTradingDay('xetra', '2026-12-24'), false);
  assert.equal(isTradingDay('euronext', '2026-12-24'), true);
});

test('mercados: símbolo → bolsa', () => {
  assert.equal(marketOf('AAPL'), 'us');
  assert.equal(marketOf('BRK-B'), 'us');
  assert.equal(marketOf('VUAA.DE'), 'xetra');
  assert.equal(marketOf('EDP.LS'), 'euronext');
  assert.equal(marketOf('SHEL.L'), 'lse');
  assert.equal(marketOf('^GSPC'), null);
  assert.equal(marketOf('EURUSD=X'), null);
  assert.equal(marketOf('7203.T'), null);
  assert.equal(marketOf(null), null);
  assert.deepEqual(marketsHeld([stockPos({ quoteSymbol: 'VUAA.DE' }), stockPos(), { kind: 'crypto' }]), ['us', 'xetra']);
});

test('mercados: pré, aberto, pós e fechado nos EUA (hora de verão e semana da mudança de hora)', () => {
  reset();
  // 16/10/2026: Lisboa UTC+1, Nova Iorque UTC−4
  let st = marketStatus('us', at('2026-10-16T13:00:00Z'));
  assert.equal(st.phase, 'pre');
  assert.equal(hhmm(st.until), '13:30', 'abre às 14:30 de Lisboa');
  st = marketStatus('us', at('2026-10-16T15:00:00Z'));
  assert.deepEqual([st.phase, hhmm(st.until)], ['open', '20:00']);
  st = marketStatus('us', at('2026-10-16T21:30:00Z'));
  assert.deepEqual([st.phase, hhmm(st.until)], ['post', '00:00']);
  st = marketStatus('us', at('2026-10-17T02:00:00Z'));
  assert.deepEqual([st.phase, st.reason, st.next.day], ['closed', 'night', '2026-10-19'], 'sexta à noite em Nova Iorque');
  st = marketStatus('us', at('2026-10-17T15:00:00Z'));
  assert.deepEqual([st.phase, st.reason, hhmm(st.next.open)], ['closed', 'weekend', '13:30']);
  // 26/10: a Europa já mudou a hora, os EUA ainda não → abre às 13:30 em Lisboa
  st = marketStatus('us', at('2026-10-26T13:00:00Z'));
  assert.deepEqual([st.phase, hhmm(st.until)], ['pre', '13:30']);
  // Thanksgiving fechado; sexta seguinte fecha às 13:00 de Nova Iorque e o pós-mercado às 17:00
  st = marketStatus('us', at('2026-11-26T15:00:00Z'));
  assert.deepEqual([st.phase, st.reason, st.next.day], ['closed', 'holiday', '2026-11-27']);
  const s = sessionOn('us', '2026-11-27');
  assert.deepEqual([hhmm(s.pre), hhmm(s.open), hhmm(s.close), hhmm(s.post)], ['09:00', '14:30', '18:00', '22:00']);
});

test('mercados: bolsas europeias sem pré/pós-mercado', () => {
  reset();
  let st = marketStatus('xetra', at('2026-10-16T06:30:00Z'));
  assert.deepEqual([st.phase, st.reason, hhmm(st.next.open)], ['closed', 'night', '07:00']);
  st = marketStatus('xetra', at('2026-10-16T15:00:00Z'));
  assert.deepEqual([st.phase, hhmm(st.until)], ['open', '15:30'], 'fecha às 16:30 de Lisboa');
  st = marketStatus('xetra', at('2026-10-16T16:00:00Z'));
  assert.deepEqual([st.phase, st.next.day], ['closed', '2026-10-19']);
  assert.equal(sessionOn('lse', '2026-12-24').close, zoned('2026-12-24', '12:30', 'Europe/London'), 'meio-dia em Londres');
});

test('mercados: a sessão de hoje indicada pelo Yahoo corrige o horário', () => {
  reset();
  const open = at('2026-10-16T13:30:00Z') / 1000, close = at('2026-10-16T17:00:00Z') / 1000;
  noteSession('us', { currentTradingPeriod: { regular: { start: open, end: close }, post: { start: close, end: close + 4 * 3600 } } });
  assert.equal(marketStatus('us', at('2026-10-16T17:30:00Z')).phase, 'post', 'fecho antecipado');
  assert.equal(marketStatus('us', at('2026-10-19T17:30:00Z')).phase, 'open', 'noutro dia volta ao horário normal');
  noteSession('us', { currentTradingPeriod: { regular: { start: close, end: open } } });
  assert.equal(state.cache.sessions.us.close, close * 1000, 'períodos inválidos são ignorados');
});

test('pós-mercado: último preço depois do fecho, face ao preço normal', () => {
  reset();
  const t = s => at(s) / 1000;
  const d = {
    chart: { result: [{
      meta: { regularMarketPrice: 200, chartPreviousClose: 190, currency: 'USD', dataGranularity: '5m' },
      timestamp: [t('2026-10-16T19:55:00Z'), t('2026-10-16T20:05:00Z'), t('2026-10-16T21:10:00Z'), t('2026-10-16T21:15:00Z')],
      indicators: { quote: [{ close: [200, 201, 203, null] }] },
    }] },
  };
  const q = parseYahooChart(d, 'AAPL');
  assert.equal(q.price, 200);
  assert.deepEqual({ ...q.ext, pct: +q.ext.pct.toFixed(2) }, { price: 203, pct: 1.5, phase: 'post', at: at('2026-10-16T21:10:00Z') });
  assert.equal(parseYahooChart(d, 'SAP.DE').ext, undefined, 'só nos EUA');

  const pre = structuredClone(d);
  pre.chart.result[0].timestamp = [t('2026-10-16T08:05:00Z'), t('2026-10-16T12:00:00Z')];
  pre.chart.result[0].indicators.quote[0].close = [198, 196];
  assert.equal(parseYahooChart(pre, 'AAPL').ext.phase, 'pre');

  const regular = structuredClone(d);
  regular.chart.result[0].indicators.quote[0].close = [200, null, null, null];
  assert.equal(extFromChart(regular, 200), null, 'último preço no horário normal');
  assert.equal(extFromChart({ ...d, chart: { result: [{ ...d.chart.result[0], meta: { dataGranularity: '1d' } }] } }, 200), null);
});

test('pós-mercado: só se mostra fora do horário normal e enquanto é recente', () => {
  reset();
  state.cache.stockPrices.AAPL = { price: 200, cur: 'USD', ext: { price: 203, pct: 1.5, phase: 'post', at: at('2026-10-16T21:10:00Z') } };
  assert.equal(extQuote('AAPL', at('2026-10-16T22:00:00Z')).price, 203);
  assert.equal(extQuote('AAPL', at('2026-10-19T15:00:00Z')), null, 'com a bolsa aberta, vale o preço normal');
  assert.equal(extQuote('AAPL', at('2026-10-18T22:00:00Z')), null, 'antigo');
});

test('pré-mercado da carteira: efeito de cada ação dos EUA, do maior para o menor', () => {
  reset();
  const now = at('2026-10-16T10:00:00Z'); // 11:00 em Lisboa, pré-mercado
  state.positions = [
    stockPos({ id: 'a', quoteSymbol: 'AAA', symbol: 'AAA', lots: [lot(10, 800)] }),
    stockPos({ id: 'b', quoteSymbol: 'BBB', symbol: 'BBB', lots: [lot(2, 100)] }),
    stockPos({ id: 'c', quoteSymbol: 'SAP.DE', symbol: 'SAP', quoteCur: 'EUR', lots: [lot(1, 100)] }),
  ];
  const ext = (price, pct) => ({ price, pct, phase: 'pre', at: now - 60_000 });
  state.cache.stockPrices = {
    AAA: { price: 100, cur: 'USD', ts: now, ext: ext(101, 1) },
    BBB: { price: 50, cur: 'USD', ts: now, ext: ext(40, -20) },
    'SAP.DE': { price: 100, cur: 'EUR', ts: now },
  };
  const rows = extRows(state.positions, now);
  assert.deepEqual(rows.map(r => [r.p.id, +r.effect.toFixed(2)]), [['b', -16], ['a', 8]], '2×(−10 US$) = −16 €; 10×1 US$ = 8 €');
  assert.deepEqual(extRows(state.positions, at('2026-10-16T15:00:00Z')), [], 'com a bolsa aberta não há pré-mercado');
});

test('futuros: ETFs europeus do S&P 500 / Nasdaq 100 e quando se mostram', async () => {
  reset();
  const etf = (symbol, name, y = `${symbol}.DE`) => stockPos({ id: symbol, symbol, name, quoteSymbol: y, quoteCur: 'EUR' });
  assert.equal(trackedIndex(etf('VUAA', 'Vanguard S&P 500 UCITS ETF (Acc)')), 'sp500');
  assert.equal(trackedIndex(etf('XYZ', 'iShares Core S&P 500 UCITS ETF', 'XYZ.L')), 'sp500');
  assert.equal(trackedIndex(etf('EQQQ', 'Invesco EQQQ NASDAQ-100 UCITS ETF')), 'ndx');
  assert.equal(trackedIndex(etf('VWCE', 'Vanguard FTSE All-World UCITS ETF')), null);
  assert.equal(trackedIndex(stockPos({ symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', quoteSymbol: 'SPY' })), null, 'nos EUA tem o próprio pré-mercado');
  assert.deepEqual(futuresWanted([etf('EQQQ', 'Nasdaq-100'), stockPos()]), ['sp500', 'ndx']);
  assert.deepEqual(futuresWanted([etf('VWCE', 'All-World')]), []);

  assert.equal(futuresTime(at('2026-10-16T10:00:00Z')), true, 'pré-mercado');
  assert.equal(futuresTime(at('2026-10-16T15:00:00Z')), false, 'bolsa aberta');
  assert.equal(futuresTime(at('2026-10-17T02:00:00Z')), true, 'noite de sexta');
  assert.equal(futuresTime(at('2026-10-17T15:00:00Z')), false, 'fim de semana');

  state.positions = [etf('VUAA', 'Vanguard S&P 500')];
  const calls = mockFetch([['ES%253DF', { chart: { result: [{ meta: { regularMarketPrice: 6010, previousClose: 6000, currency: 'USD' } }], error: null } }]]);
  assert.equal(await fetchFutures(at('2026-10-16T15:00:00Z')), 0, 'com a bolsa aberta não pede');
  assert.equal(calls.length, 0);
  assert.equal(await fetchFutures(at('2026-10-16T10:00:00Z')), 1);
  const q = futureQuote('sp500', Date.now());
  assert.equal(+q.dayPct.toFixed(3), 0.167);
  assert.equal(futureQuote('sp500', Date.now() + 4 * 3600_000), null, 'antigo');
  assert.equal(futureQuote('ndx'), null);
});
