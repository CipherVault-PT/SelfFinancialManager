import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STOCKS, byQuote, resolveStock, twelveDataSymbol, micOf, searchLocal, currencyOfSymbol } from '../js/stocks.js';
import { moneyParts, money, pct, num, todayISO, esc, inputNum } from '../js/format.js';

test('base de ações: símbolos Yahoo únicos e moedas válidas', () => {
  const ys = STOCKS.map(s => s.y);
  assert.equal(new Set(ys).size, ys.length);
  for (const s of STOCKS) {
    assert.match(s.c, /^[A-Z]{3}$/, s.n);
    assert.ok(s.n && s.t && s.y, JSON.stringify(s));
  }
});

test('base de ações: tickers repetidos resolvem pela bolsa', () => {
  assert.equal(resolveStock('DTE', 'Xetra').y, 'DTE.DE');
  assert.equal(resolveStock('DTE', 'Serv. públicos').y, 'DTE');
  assert.equal(resolveStock('TSCO', 'Londres').y, 'TSCO.L');
  assert.equal(resolveStock('COR', 'Lisboa').y, 'COR.LS');
  assert.equal(resolveStock('DG', 'Paris').y, 'DG.PA');
  assert.equal(resolveStock('DTE').y, 'DTE', 'sem bolsa fica a listagem com o mesmo símbolo Yahoo');
  assert.equal(resolveStock('BA.L').y, 'BA.L');
  assert.equal(resolveStock('ZZZZ'), null);
  assert.equal(byQuote('RYA.IR').n, 'Ryanair');
  assert.equal(byQuote('STLAM.MI').n, 'Stellantis');
});

test('Twelve Data: símbolo e MIC', () => {
  assert.equal(twelveDataSymbol('BRK-B'), 'BRK.B');
  assert.equal(twelveDataSymbol('BA.L'), 'BA');
  assert.equal(micOf('BA.L'), 'XLON');
  assert.equal(micOf('AAPL'), '');
});

test('pesquisa local dá prioridade a correspondências no início', () => {
  assert.equal(searchLocal('galp')[0].y, 'GALP.LS');
  assert.equal(searchLocal('AAPL')[0].y, 'AAPL');
});

test('pesquisa local: nome como na corretora ("… USD (Acc)") e ISIN encontram as versões em €', () => {
  assert.equal(searchLocal('FTSE All-World USD (Acc)')[0].y, 'VWCE.DE');
  assert.deepEqual(searchLocal(' ie00b5bmr087 ').map(s => s.y), ['SXR8.DE', 'CSPX.L']);
  assert.ok(searchLocal('core s&p 500 usd acc').some(s => s.y === 'SXR8.DE'));
  assert.deepEqual(searchLocal('usd'), searchLocal('usd'), 'só palavras ignoradas: não rebenta');
  assert.equal(searchLocal('zzzz qqqq').length, 0);
});

test('base de ações: ISIN com dígito de controlo válido', () => {
  const ok = isin => {
    const digits = [...isin.slice(0, -1)].map(c => parseInt(c, 36)).join('');
    let sum = 0;
    [...digits].reverse().forEach((ch, i) => { let d = +ch; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; });
    return (10 - (sum % 10)) % 10 === +isin.at(-1);
  };
  const withIsin = STOCKS.filter(s => s.i);
  assert.ok(withIsin.length >= 10);
  for (const s of withIsin) assert.ok(/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s.i) && ok(s.i), `${s.y}: ${s.i}`);
});

test('moeda pelo sufixo do símbolo: Xetra/Amsterdão em €, EUA em $, Londres ambígua', () => {
  assert.deepEqual(['EUNL.DE', 'IWDA.AS', 'ZZA', 'ZZW.L', 'ZZW.SW', 'ES=F', 'ZZN.CO'].map(currencyOfSymbol), ['EUR', 'EUR', 'USD', null, null, null, 'DKK']);
});

test('formatação: valor grande em USD sem "US" e com separador de milhares', () => {
  const { int, dec, symbol } = moneyParts(12345.67, 'USD');
  assert.equal(symbol, '$');
  assert.ok(!/US/.test(int + dec));
  assert.equal(int.replace(/\D/g, ''), '12345');
  assert.notEqual(int, '12345', 'mantém o separador de milhares');
  assert.equal(dec, ',67');
  assert.equal(money(NaN, 'EUR'), money(0, 'EUR'));
  assert.ok(money(5, 'XYZ1').includes('XYZ1'), 'moeda inválida não rebenta');
});

test('formatação: percentagens, números com vírgula e datas locais', () => {
  assert.equal(pct(null), '—');
  assert.equal(pct(1.234), '+1,23%');
  assert.equal(num('0,8728'), 0.8728);
  assert.equal(num('1.234,56'), 1234.56);
  assert.equal(num('12.5'), 12.5);
  assert.ok(Number.isNaN(num('abc')));
  assert.equal(inputNum(0.000123), '0,000123');
  assert.equal(todayISO(new Date(2025, 0, 2, 0, 30)), '2025-01-02');
  assert.equal(esc(`<a href='x'>`), '&lt;a href=&#39;x&#39;&gt;');
});

test('service worker inclui todos os ficheiros da app', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const walk = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of [...walk('js'), ...walk('css'), ...walk('icons')]) {
    assert.ok(sw.includes(`'./${f}'`), `falta ${f} no sw.js`);
  }
});
