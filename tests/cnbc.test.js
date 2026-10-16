import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { cnbcUrl, parseCnbc, mergeExtended, cnbcExtended, isCnbc } from '../js/quotes/cnbc.js';
import { viaProxies } from '../js/quotes/stocks.js';
import { reset, mockFetch } from './helpers.js';

const at = s => Date.parse(s);
const ext = (last, last_time, extra = {}) => ({ type: 'PRE_MKT', last, change: '+0.07', change_pct: '+1.96%', last_time, ...extra });
const formatted = quotes => ({ FormattedQuoteResult: { FormattedQuote: quotes } });

test('CNBC: endereço com vários símbolos e classes de ações (BRK-B → BRK.B)', () => {
  const u = cnbcUrl(['ARRY', 'BRK-B']);
  assert.match(u, /^https:\/\/quote\.cnbc\.com\/quote-html-webservice\/restQuote\/symbolType\/symbol\?symbols=ARRY%7CBRK\.B&/);
  assert.match(u, /exthrs=1/);
  assert.match(u, /output=json/);
  assert.equal(isCnbc(formatted([])), true);
  assert.equal(isCnbc({ chart: {} }), false);
});

test('CNBC: lê o último negócio do pré/pós-mercado; ignora o horário normal e respostas estragadas', () => {
  const d = formatted([
    { symbol: 'ARRY', last: '3.57', ExtendedMktQuote: ext('3.64', '2026-10-16T08:31:12.000-0400') },
    { symbol: 'BRK.B', last: '450', ExtendedMktQuote: ext('1,234.50', '', { type: 'POST_MKT', last_time_msec: String(at('2026-10-15T21:10:00Z')) }) },
    { symbol: 'TTD', last: '13.13', ExtendedMktQuote: ext('13.2', '2026-10-15T11:00:00.000-0400') }, // horário normal
    { symbol: 'XPEV', last: '9.63' },
    { symbol: 'BAD', ExtendedMktQuote: ext('abc', '2026-10-16T08:31:12.000-0400') },
  ]);
  const r = parseCnbc(d, ['ARRY', 'BRK-B', 'TTD', 'XPEV', 'BAD']);
  assert.deepEqual(r.ARRY, { price: 3.64, phase: 'pre', at: at('2026-10-16T12:31:12Z'), src: 'cnbc' });
  assert.deepEqual(r['BRK-B'], { price: 1234.5, phase: 'post', at: at('2026-10-15T21:10:00Z'), src: 'cnbc' });
  assert.deepEqual(Object.keys(r).sort(), ['ARRY', 'BRK-B']);
  const quick = { QuickQuoteResult: { QuickQuote: { symbol: 'ARRY', extendedMktQuote: ext('3.65', '2026-10-16T08:40:00.000-0400') } } };
  assert.equal(parseCnbc(quick, ['ARRY']).ARRY.price, 3.65, 'formato alternativo, com um só resultado');
  assert.deepEqual(parseCnbc(null), {});
});

test('CNBC + Yahoo: fica o negócio mais recente; preços absurdos são ignorados', () => {
  const quotes = {
    ARRY: { price: 3.57, ext: { price: 3.58, pct: 0.28, phase: 'post', at: at('2026-10-15T23:00:00Z'), src: 'yahoo' } },
    TTD: { price: 13.13, ext: { price: 13.23, pct: 0.76, phase: 'pre', at: at('2026-10-16T12:35:00Z'), src: 'yahoo' } },
    XPEV: { price: 9.63 },
    OOPS: { price: 10 },
  };
  const used = mergeExtended(quotes, {
    ARRY: { price: 3.64, phase: 'pre', at: at('2026-10-16T12:31:12Z'), src: 'cnbc' },
    TTD: { price: 13.19, phase: 'pre', at: at('2026-10-16T12:30:00Z'), src: 'cnbc' },
    XPEV: { price: 9.61, phase: 'pre', at: at('2026-10-16T12:32:00Z'), src: 'cnbc' },
    OOPS: { price: 100, phase: 'pre', at: at('2026-10-16T12:32:00Z'), src: 'cnbc' },
  });
  assert.equal(used, 2);
  assert.deepEqual([quotes.ARRY.ext.price, quotes.ARRY.ext.src, +quotes.ARRY.ext.pct.toFixed(2)], [3.64, 'cnbc', 1.96]);
  assert.equal(quotes.TTD.ext.src, 'yahoo', 'o Yahoo tinha um negócio mais recente');
  assert.equal(quotes.XPEV.ext.src, 'cnbc');
  assert.equal(quotes.OOPS.ext, undefined, '10× o fecho: ignorado');
});

test('CNBC: só no pré/pós-mercado, só pelo atalho próprio e pausa 15 min se não responder', async () => {
  reset({ settings: { proxyUrl: 'https://meu.workers.dev' } });
  const pre = at('2026-10-16T12:40:00Z');
  let calls = mockFetch([['meu.workers.dev', formatted([{ symbol: 'ARRY', ExtendedMktQuote: ext('3.64', '2026-10-16T08:31:12.000-0400') }])]]);
  assert.deepEqual(await cnbcExtended(['ARRY'], viaProxies, at('2026-10-16T15:00:00Z')), {}, 'bolsa aberta: não pede');
  assert.equal(calls.length, 0);
  assert.equal((await cnbcExtended(['ARRY'], viaProxies, pre)).ARRY.price, 3.64);
  assert.equal(calls.length, 1);
  assert.ok(decodeURIComponent(calls[0]).includes('quote.cnbc.com'));

  calls = mockFetch([['meu.workers.dev', { error: 'Domínio não permitido', __status: 403 }]]);
  assert.deepEqual(await cnbcExtended(['ARRY'], viaProxies, pre), {});
  assert.ok(calls.every(u => u.startsWith('https://meu.workers.dev')), 'não tenta os intermediários públicos');
  assert.ok(state.cache.cnbcFail > 0);
  assert.deepEqual(await cnbcExtended(['ARRY'], viaProxies, pre + 60_000), {});
  assert.equal(calls.length, 1, 'em pausa depois de falhar');
  calls = mockFetch([['meu.workers.dev', formatted([])]]);
  await cnbcExtended(['ARRY'], viaProxies, pre + 16 * 60_000);
  assert.equal(calls.length, 1, 'passados 15 min volta a tentar');
});
