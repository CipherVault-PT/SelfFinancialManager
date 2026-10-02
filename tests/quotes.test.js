import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { fetchFx, parseRates } from '../js/fx.js';
import { fetchCryptoPrices, parseCoinGecko } from '../js/quotes/crypto.js';
import { fetchStockQuotes, parseYahooChart, parseTwelveData, searchYahoo } from '../js/quotes/stocks.js';
import { reset, stockPos, lot, mockFetch } from './helpers.js';

const chart = meta => ({ chart: { result: [{ meta }], error: null } });

test('Yahoo: pence → libras, incluindo o fecho anterior (bug: variação do dia dava -99%)', () => {
  const q = parseYahooChart(chart({ regularMarketPrice: 505, previousClose: 500, currency: 'GBp' }));
  assert.equal(q.cur, 'GBP');
  assert.equal(q.price, 5.05);
  assert.ok(Math.abs(q.dayPct - 1) < 1e-9);
});

test('Yahoo/Twelve Data: rejeitam moedas inválidas e respostas de erro', () => {
  assert.equal(parseYahooChart(chart({ regularMarketPrice: 10, currency: '<img src=x>' })), null);
  assert.equal(parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } }), null);
  assert.equal(parseTwelveData({ status: 'error', code: 404 }), null);
  assert.deepEqual(parseTwelveData({ close: '12.5', currency: 'EUR', percent_change: '-1.2', name: 'X' }), { price: 12.5, cur: 'EUR', dayPct: -1.2, name: 'X' });
});

test('câmbio: aceita só taxas válidas', async () => {
  assert.equal(parseRates({ GBP: 0.8 }), null);
  assert.deepEqual(parseRates({ USD: 1.1, BAD: -1, xx: 2 }), { USD: 1.1, EUR: 1 });
  reset();
  state.cache.fxUpdated = 0;
  mockFetch([['frankfurter.app', { rates: { USD: 1.1, GBP: 0.85, JPY: 160 } }]]);
  assert.equal(await fetchFx(), true);
  assert.equal(state.cache.rates.USD, 1.1);
  assert.equal(state.cache.rates.JPY, 160);
});

test('cripto: CoinGecko e reserva Binance quando há limite de pedidos', async () => {
  reset();
  state.positions = [
    { id: 'c1', kind: 'crypto', currency: 'EUR', symbol: 'BTC', coingeckoId: 'bitcoin', lots: [lot(1, 1)] },
    { id: 'c2', kind: 'crypto', currency: 'EUR', symbol: 'SOL', coingeckoId: 'solana', lots: [lot(1, 1)] },
  ];
  mockFetch([['coingecko.com', { bitcoin: { eur: 50_000, usd: 62_500, eur_24h_change: 1.5 } }]]);
  assert.equal(await fetchCryptoPrices({ force: true }), true);
  assert.equal(state.cache.prices.bitcoin.eur, 50_000);
  assert.equal(state.cache.prices.solana, undefined);

  const calls = mockFetch([
    ['coingecko.com', { __status: 429 }],
    ['symbol=BTCUSDT', { lastPrice: '62500.00', priceChangePercent: '-2.5' }],
    ['symbol=SOLUSDT', { lastPrice: '125', priceChangePercent: '3' }],
  ]);
  assert.equal(await fetchCryptoPrices({ force: true }), true);
  assert.equal(state.cache.prices.solana.usd, 125);
  assert.equal(state.cache.prices.solana.eur, 100);
  assert.ok(calls.some(u => u.includes('binance')));
  assert.equal(parseCoinGecko({ x: { eur: 'NaN' } }).x, undefined);
});

test('ações: tickers repetidos têm cotações separadas; intermediário próprio tem prioridade', async () => {
  reset({ settings: { proxyUrl: 'https://meu.workers.dev' } });
  state.positions = [
    stockPos({ id: 'a', quoteSymbol: 'DTE', quoteCur: 'USD' }),
    stockPos({ id: 'b', quoteSymbol: 'DTE.DE', quoteCur: 'EUR', lots: [lot(1, 30)] }),
  ];
  const calls = mockFetch([
    ['meu.workers.dev', url => {
      const target = decodeURIComponent(new URL(url).searchParams.get('url'));
      return target.includes('/DTE.DE?')
        ? chart({ regularMarketPrice: 31, chartPreviousClose: 30, currency: 'EUR' })
        : chart({ regularMarketPrice: 120, chartPreviousClose: 120, currency: 'USD' });
    }],
  ]);
  const r = await fetchStockQuotes({ force: true });
  assert.deepEqual(r, { ok: 2, fail: 0, total: 2 });
  assert.equal(state.cache.stockPrices['DTE.DE'].price, 31);
  assert.equal(state.cache.stockPrices.DTE.price, 120);
  assert.ok(calls.every(u => u.startsWith('https://meu.workers.dev')));
});

test('ações: intermediários públicos em sequência, memória do que funcionou e pausa após falhas', async () => {
  reset();
  state.positions = [stockPos({ quoteSymbol: 'AAPL' })];
  let calls = mockFetch([['codetabs', chart({ regularMarketPrice: 200, currency: 'USD' })]]);
  assert.equal((await fetchStockQuotes({ force: true })).ok, 1);
  assert.equal(state.cache.proxyPref, 'codetabs');
  assert.equal(calls.length, 3);

  calls = mockFetch([['codetabs', chart({ regularMarketPrice: 201, currency: 'USD' })]]);
  await fetchStockQuotes({ force: true });
  assert.equal(calls.length, 1, 'tenta primeiro o intermediário que funcionou');

  calls = mockFetch([['codetabs', { chart: { result: null, error: { code: 'Not Found' } } }]]);
  state.positions[0].quoteSymbol = 'NOPE';
  assert.equal((await fetchStockQuotes({ force: true })).fail, 1);
  assert.equal(calls.length, 1, 'resposta válida sem dados não tenta outros intermediários');
  calls = mockFetch([]);
  await fetchStockQuotes();
  assert.equal(calls.length, 0, 'símbolo que falhou fica em pausa');
});

test('ações: Twelve Data como reserva com símbolo e bolsa corretos', async () => {
  reset({ settings: { apiKey: 'k' } });
  state.positions = [stockPos({ quoteSymbol: 'SAN.MC', quoteCur: 'EUR' })];
  const calls = mockFetch([['twelvedata', { close: '6.1', currency: 'EUR', percent_change: '0.5' }]]);
  assert.equal((await fetchStockQuotes({ force: true })).ok, 1);
  const td = calls.find(u => u.includes('twelvedata'));
  assert.match(td, /symbol=SAN&mic_code=XMAD/);
});

test('pesquisa global no Yahoo filtra tipos e normaliza', async () => {
  reset();
  mockFetch([['allorigins', { quotes: [
    { symbol: 'VWCE.DE', longname: 'Vanguard FTSE All-World', quoteType: 'ETF', exchDisp: 'XETRA', typeDisp: 'ETF' },
    { symbol: 'X', quoteType: 'OPTION' },
  ] }]]);
  const r = await searchYahoo('vwce');
  assert.deepEqual(r.map(x => x.y), ['VWCE.DE']);
  assert.equal(r[0].x, 'XETRA · ETF');
});
