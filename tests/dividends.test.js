import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate, hasData, wipe, exportJSON, importJSON } from '../js/store.js';
import { addDividend, dividendTotal, dividendStats, dividendAssets, removeDividend } from '../js/dividends.js';
import { dividendLines, dividendSummary, dividendCSV, taxYears, ensureFxHistory } from '../js/tax.js';
import { reset, lot, stockPos, mockFetch } from './helpers.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('dividendos por posição: total líquido convertido para a moeda da conta', () => {
  reset();
  const p = stockPos({ quoteCur: 'USD' });
  state.positions = [p];
  addDividend(p, { date: '2025-03-01', gross: 10, withheld: 1.5, currency: 'EUR' });
  addDividend(p, { date: '2025-06-01', gross: 12.5, withheld: 1.875, currency: 'USD' }); // 10,625 $ = 8,5 €
  close(dividendTotal(p.id, 'EUR'), 8.5 + 8.5);
  assert.equal(state.dividends[0].name, 'Apple');
  removeDividend(state.dividends[0].id);
  assert.equal(state.dividends.length, 1);
});

test('estatísticas: total e últimos 12 meses', () => {
  reset();
  const p = stockPos();
  addDividend(p, { date: '2024-01-15', gross: 20, withheld: 0, currency: 'EUR' });
  addDividend(p, { date: '2025-09-01', gross: 10, withheld: 0, currency: 'EUR' });
  const st = dividendStats('EUR', new Date(2025, 9, 1));
  assert.equal(st.total, 30);
  assert.equal(st.last12, 10);
  assert.equal(st.count, 2);
});

test('ativos com dividendos: ações abertas e vendidas, sem cripto nem duplicados', () => {
  reset();
  state.positions = [stockPos({ id: 'open' }), { id: 'btc', kind: 'crypto', name: 'Bitcoin', lots: [lot(1, 1)] }];
  state.closed = [
    { ...stockPos({ id: 'sale1' }), parentId: 'open', partial: true },
    { ...stockPos({ id: 'gone', name: 'Galp' }) },
  ];
  assert.deepEqual(dividendAssets().map(a => [a.id, a.open]), [['open', true], ['gone', false]]);
});

test('relatório: EUR pelo câmbio do BCE, imposto adicional por dividendo e aviso de retenção alta', () => {
  reset();
  state.cache.fxHist = { '2025-03-03': { USD: 1.25 } };
  const p = stockPos();
  addDividend(p, { date: '2025-03-03', gross: 125, withheld: 18.75, currency: 'USD' }); // 100 € bruto, 15 € retido
  addDividend(p, { date: '2025-05-01', gross: 100, withheld: 30, currency: 'EUR' });    // retenção de 30%
  addDividend(p, { date: '2024-12-01', gross: 50, withheld: 0, currency: 'EUR' });
  const lines = dividendLines();
  const s = dividendSummary(lines, 2025);
  assert.equal(s.count, 2);
  close(s.gross, 200);
  close(s.withheld, 45);
  close(s.net, 155);
  close(s.ptTax, 28 - 15 + 0, 1e-9);
  assert.equal(s.highWithholding, 1);
  assert.equal(s.approxFx, 0);
  assert.deepEqual(taxYears(lines), ['2025', '2024']);
});

test('CSV de dividendos para Excel PT', () => {
  reset();
  addDividend(stockPos(), { date: '2025-05-01', gross: 100, withheld: 30, currency: 'EUR' });
  const csv = dividendCSV(dividendLines());
  assert.ok(csv.startsWith('﻿Data;Ativo;Símbolo;Corretora;Moeda;Bruto (moeda)'));
  assert.equal(csv.split('\r\n')[1], '2025-05-01;Apple;AAPL;XTB;EUR;100,00;30,00;100,00;30,00;70,00;retenção acima de 15%');
});

test('câmbio histórico também para dividendos fora do euro', async () => {
  reset();
  state.cache.fxHist = {};
  addDividend(stockPos(), { date: '2025-03-03', gross: 10, withheld: 0, currency: 'USD' });
  const calls = mockFetch([['frankfurter.app', { rates: { '2025-03-03': { USD: 1.05 } } }]]);
  assert.equal(await ensureFxHistory([], state.dividends), true);
  assert.match(calls[0], /2025-02-24\.\.2025-03-03\?from=EUR&to=USD/);
});

test('guardar, apagar e importar mantêm os dividendos', () => {
  reset();
  hydrate({ version: 2, positions: [], closed: [], cash: [], dividends: [
    { id: 'd1', posId: 'p', name: 'X', date: '2025-01-01', gross: '10', withheld: '1', currency: 'EUR' },
    { id: 'bad', name: 'Y', date: '', gross: 5 },
  ] });
  assert.equal(state.dividends.length, 1);
  assert.equal(state.dividends[0].gross, 10);
  assert.equal(hasData(), true, 'só dividendos também conta como dados');
  const json = exportJSON();
  wipe();
  assert.equal(state.dividends.length, 0);
  importJSON(json);
  assert.equal(state.dividends[0].id, 'd1');
});
