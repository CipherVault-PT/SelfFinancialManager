import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { dayMoveAt, dayWord, notToday } from '../js/markets.js';
import { agg, metrics } from '../js/calc.js';
import { watchQuote } from '../js/watchlist.js';
import { parseYahooChart, parseTwelveData } from '../js/quotes/stocks.js';
import { reset, stockPos, lot } from './helpers.js';

process.env.TZ = 'Europe/Lisbon'; // "hoje" é o dia de quem usa a app (cada ficheiro de testes corre noutro processo)

const at = s => Date.parse(s);
const local = (d, h) => new Date(2026, 9, d, h, 0).getTime(); // outubro de 2026, na hora do dispositivo

test('variação do dia: guarda a hora do último negócio no horário normal (Yahoo e Twelve Data)', () => {
  const y = parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 11, previousClose: 10, currency: 'USD', regularMarketTime: 1_792_000_000 } }] } });
  assert.equal(y.mt, 1_792_000_000_000);
  const t = parseTwelveData({ close: '5', currency: 'EUR', percent_change: '1', last_quote_at: 1_792_000_000 });
  assert.equal(t.mt, 1_792_000_000_000);
  assert.equal('mt' in parseTwelveData({ close: '5', currency: 'EUR', percent_change: '1' }), false);
});

test('variação do dia: "hoje", "ontem", dia da semana ou data', () => {
  const now = local(16, 10); // sexta
  assert.equal(dayWord(local(16, 1), now), 'hoje');
  assert.equal(dayWord(local(15, 22), now), 'ontem');
  assert.equal(dayWord(local(13, 22), now), 'ter.');
  assert.equal(dayWord(local(2, 12), now), '2/10');
});

test('variação do dia: sem a hora do negócio, conta a última sessão antes de a cotação chegar', () => {
  reset();
  const fri = at('2026-10-16T10:00:00Z');
  assert.equal(dayMoveAt('ZZA', { mt: 123 }), 123);
  assert.equal(dayMoveAt('ZZA', { ts: at('2026-10-15T22:00:00Z') }), at('2026-10-15T13:30:00Z'), 'pedida à noite: sessão de quinta');
  assert.equal(dayWord(dayMoveAt('ZZA', { ts: fri }), fri), 'ontem', 'de manhã, antes da abertura dos EUA');
  assert.equal(dayMoveAt('ZZA', { ts: at('2026-10-16T14:00:00Z') }), at('2026-10-16T13:30:00Z'), 'depois da abertura');
  assert.equal(dayMoveAt('ZZB.DE', { ts: fri }), at('2026-10-16T07:00:00Z'), 'Xetra já abriu às 9:00 de Frankfurt');
  assert.equal(dayMoveAt('ZZ=F', { ts: 42 }), 42, 'sem bolsa conhecida: a hora da cotação');
});

test('"Hoje" antes da abertura: as ações dos EUA ficam de fora e a nota diz quando abrem', () => {
  reset();
  const fri = at('2026-10-16T10:00:00Z'), sat = at('2026-10-17T12:00:00Z');
  state.positions = [
    stockPos({ id: 'a', quoteSymbol: 'ZZA', symbol: 'ZZA' }),
    stockPos({ id: 'b', quoteSymbol: 'ZZB.DE', symbol: 'ZZB', quoteCur: 'EUR' }),
    stockPos({ id: 'c', quoteSymbol: 'ZZC', symbol: 'ZZC', manualPrice: 50 }),
  ];
  state.cache.stockPrices.ZZA = { price: 100, cur: 'USD', dayPct: 5, mt: at('2026-10-15T20:00:00Z'), ts: fri };
  state.cache.stockPrices['ZZB.DE'] = { price: 90, cur: 'EUR', dayPct: -1, mt: at('2026-10-16T09:55:00Z'), ts: fri };
  assert.deepEqual(notToday(state.positions, fri), [{ id: 'us', open: at('2026-10-16T13:30:00Z') }]);
  assert.deepEqual(notToday(state.positions, at('2026-10-16T13:40:00Z')), [], 'já abriu: espera pela próxima cotação');
  assert.deepEqual(notToday(state.positions, sat).map(x => x.open), [null, null], 'sábado: as duas fechadas');
  state.cache.stockPrices.ZZA.mt = at('2026-10-16T14:00:00Z');
  assert.deepEqual(notToday(state.positions, fri + 4 * 3600_000), []);
});

test('"Hoje" soma só o que mexeu hoje; o cartão diz de quando é a variação', () => {
  reset();
  const now = Date.now();
  state.positions = [
    stockPos({ id: 'a', quoteSymbol: 'ZZA', symbol: 'ZZA', lots: [lot(10, 800)] }),
    { id: 'c', kind: 'crypto', platform: 'Revolut', currency: 'EUR', coingeckoId: 'zzcoin', lots: [lot(1, 100)] },
  ];
  state.cache.stockPrices.ZZA = { price: 110, cur: 'USD', dayPct: 10, mt: now - 36 * 3600_000, ts: now };
  state.cache.prices.zzcoin = { eur: 105, eur_24h_change: 5, ts: now };
  const s = metrics(state.positions[0], 'EUR'), c = metrics(state.positions[1], 'EUR');
  assert.equal(s.dayToday, false);
  assert.notEqual(dayWord(s.dayAt), 'hoje');
  assert.ok(s.dayD > 0, 'o cartão continua a mostrar a variação da última sessão');
  assert.equal(c.dayToday, true);
  assert.ok(Math.abs(agg('EUR').dayChange - c.dayD) < 1e-9, 'só a cripto conta');
  state.cache.stockPrices.ZZA.mt = now;
  assert.ok(Math.abs(agg('EUR').dayChange - (c.dayD + s.dayD)) < 1e-9, 'depois da abertura entra tudo');
});

test('lista de acompanhamento: a variação traz o dia a que se refere', () => {
  reset();
  state.cache.stockPrices.ZZA = { price: 10, cur: 'USD', dayPct: 2, mt: 777, ts: 1 };
  assert.equal(watchQuote({ kind: 'stock', quoteSymbol: 'ZZA' }).at, 777);
});
