import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate, exportJSON, hasData } from '../js/store.js';
import { watchQuote, addWatch, updateWatch, removeWatch, checkWatch, toTarget, reached, sinceAdded } from '../js/watchlist.js';
import { fetchStockQuotes } from '../js/quotes/stocks.js';
import { fetchCryptoPrices } from '../js/quotes/crypto.js';
import { userPart } from '../js/sync/engine.js';
import { reset, stockPos, mockFetch } from './helpers.js';

const STOCK = { kind: 'stock', name: 'Empresa Inventada', symbol: 'INVT', quoteSymbol: 'INVT', quoteCur: 'USD' };
const COIN = { kind: 'crypto', name: 'Moeda Inventada', symbol: 'INV', coingeckoId: 'moeda-inventada', cur: 'EUR' };

test('lista: juntar (sem repetir), editar, tirar; guarda o preço do dia em que entrou', () => {
  reset();
  const w = addWatch({ ...STOCK }, { price: 50, cur: 'USD' });
  assert.equal(w.addedPrice, 50);
  assert.equal(w.notify, true);
  const again = addWatch({ ...STOCK, note: 'outra vez' });
  assert.equal(again.id, w.id);
  assert.equal(state.watchlist.length, 1);
  assert.equal(state.watchlist[0].note, 'outra vez');
  addWatch({ ...COIN });
  assert.equal(state.watchlist[0].kind, 'crypto', 'os mais recentes primeiro');
  w.fired = true;
  updateWatch(w.id, { target: 40 });
  assert.equal(w.fired, false, 'mudar o alvo volta a ligar o aviso');
  assert.equal(removeWatch(w.id).name, 'Empresa Inventada');
  assert.equal(state.watchlist.length, 1);
  assert.equal(removeWatch('nada'), null);
});

test('lista: cotação de ações e cripto (com conversão), distância ao alvo e desde que entrou', () => {
  reset();
  const s = addWatch({ ...STOCK, target: 45 }, { price: 50, cur: 'USD' });
  assert.equal(watchQuote(s).live, false);
  state.cache.stockPrices.INVT = { price: 60, cur: 'USD', dayPct: 2, ts: 1 };
  const q = watchQuote(s);
  assert.deepEqual([q.price, q.cur, q.dayPct, q.live], [60, 'USD', 2, true]);
  assert.equal(toTarget(s, q), -25);
  assert.equal(sinceAdded(s, q), 20);
  assert.equal(reached(s, q), false);

  const c = addWatch({ ...COIN });
  state.cache.prices['moeda-inventada'] = { usd: 10, usd_24h_change: -3, ts: 1 };
  assert.deepEqual([watchQuote(c).price, watchQuote(c).dayPct], [8, -3], '10 USD a 1,25 = 8 EUR');
  state.cache.prices['moeda-inventada'].eur = 8.5;
  assert.equal(watchQuote(c).price, 8.5);
});

test('lista: aviso quando chega ao alvo — uma vez, nos dois sentidos', () => {
  reset();
  const down = addWatch({ ...STOCK, target: 45 });
  const up = addWatch({ ...STOCK, quoteSymbol: 'UPUP', symbol: 'UPUP', name: 'Sobe', target: 100, above: true });
  addWatch({ ...STOCK, quoteSymbol: 'MUTE', symbol: 'MUTE', name: 'Calado', target: 1000, above: true, notify: false });
  state.cache.stockPrices = { INVT: { price: 50, cur: 'USD' }, UPUP: { price: 99, cur: 'USD' }, MUTE: { price: 2000, cur: 'USD' } };
  assert.deepEqual(checkWatch(), []);
  state.cache.stockPrices.INVT.price = 44.9;
  state.cache.stockPrices.UPUP.price = 100;
  const fired = checkWatch();
  assert.deepEqual(fired.map(f => [f.name, f.above, f.now, f.price, f.cur]), [['Sobe', true, 100, 100, 'USD'], ['Empresa Inventada', false, 44.9, 45, 'USD']]);
  assert.deepEqual(checkWatch(), [], 'só avisa uma vez');
  assert.ok(down.fired && up.fired);
});

test('lista: guardada, sincronizada e normalizada; entradas inválidas caem', () => {
  reset();
  assert.equal(hasData(), false);
  addWatch({ ...STOCK, target: 45 }, { price: 50, cur: 'USD' });
  assert.equal(hasData(), true);
  const before = userPart(state);
  state.watchlist[0].note = 'mudou';
  assert.notEqual(userPart(state), before, 'mudar a lista conta como alteração para sincronizar');
  const saved = JSON.parse(exportJSON());
  hydrate({ ...saved, watchlist: [...saved.watchlist, { kind: 'stock', name: 'Sem símbolo' }, null, { kind: 'crypto', name: 'X', coingeckoId: 'x', cur: 'GBP', target: -1 }] });
  assert.equal(state.watchlist.length, 2);
  assert.deepEqual([state.watchlist[0].target, state.watchlist[0].note, state.watchlist[0].addedPrice], [45, 'mudou', 50]);
  assert.deepEqual([state.watchlist[1].cur, state.watchlist[1].target], ['EUR', null]);
  hydrate({ version: 2, positions: [] });
  assert.deepEqual(state.watchlist, [], 'dados antigos sem lista');
});

test('lista: as cotações incluem os ativos seguidos', async () => {
  reset({ settings: { proxyUrl: 'https://meu.workers.dev' } });
  state.positions = [stockPos({ quoteSymbol: 'SAP.DE', quoteCur: 'EUR' })];
  addWatch({ ...STOCK, quoteSymbol: 'ASML.AS', symbol: 'ASML', quoteCur: null });
  const calls = mockFetch([['meu.workers.dev', { chart: { result: [{ meta: { regularMarketPrice: 700, chartPreviousClose: 690, currency: 'EUR' } }], error: null } }]]);
  const r = await fetchStockQuotes({ force: true });
  assert.equal(r.total, 2);
  assert.ok(calls.some(u => decodeURIComponent(u).includes('/ASML.AS?')));
  assert.equal(state.watchlist[0].quoteCur, 'EUR', 'aprende a moeda da cotação');

  addWatch({ ...COIN });
  mockFetch([['coingecko.com', { 'moeda-inventada': { eur: 3, usd: 3.75 } }]]);
  assert.equal(await fetchCryptoPrices({ force: true }), true);
  assert.equal(state.cache.prices['moeda-inventada'].eur, 3);
});
