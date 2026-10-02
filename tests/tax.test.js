import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { sellFIFO } from '../js/calc.js';
import { taxLines, taxSummary, taxYears, defaultTaxYear, histRate, taxCSV, ensureFxHistory } from '../js/tax.js';
import { reset, lot, mockFetch } from './helpers.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const sale = (extra = {}) => ({
  id: 's', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Galp', symbol: 'GALP',
  lots: [lot(10, 100, { date: '2025-01-10' })], proceeds: 150, closedAt: '2025-06-10', ...extra,
});

test('venda parcial FIFO: uma linha por compra, com o valor de realização repartido', () => {
  reset();
  const { sold } = sellFIFO([lot(10, 100, { date: '2024-03-01' }), lot(10, 200, { date: '2025-01-10' })], 15);
  state.closed = [sale({ lots: sold, proceeds: 300 })];
  const lines = taxLines();
  assert.deepEqual(lines.map(l => [l.acqDate, l.units]), [['2024-03-01', 10], ['2025-01-10', 5]]);
  close(lines[0].saleEUR, 200);
  close(lines[1].saleEUR, 100);
  close(lines[0].gain + lines[1].gain, 300 - 200);
  assert.deepEqual(lines.map(l => l.days), [466, 151]);
});

test('resumo anual: saldo, imposto estimado a 28% e cripto excluída', () => {
  reset();
  state.closed = [
    sale({ id: 'a', proceeds: 200 }),                                   // +100
    sale({ id: 'b', proceeds: 70, closedAt: '2025-08-01' }),            // −30
    sale({ id: 'c', kind: 'crypto', proceeds: 500, lots: [lot(1, 100, { date: '2023-01-01' })] }), // ≥ 365 dias
    sale({ id: 'd', kind: 'crypto', proceeds: 150, lots: [lot(1, 100, { date: '2025-03-01' })] }), // < 365 dias
    sale({ id: 'e', proceeds: 999, closedAt: '2024-05-05' }),           // outro ano
  ];
  const s = taxSummary(taxLines(), 2025);
  assert.equal(s.lines.length, 4);
  close(s.groups.securities.net, 70);
  close(s.groups.securities.tax, 70 * 0.28);
  assert.equal(s.groups.cryptoLong.count, 1);
  assert.equal(s.groups.cryptoLong.tax, 0);
  close(s.groups.crypto.tax, 50 * 0.28);
  close(s.taxTotal, (70 + 50) * 0.28);
  assert.equal(s.shortTermGains, 1, 'ganho em ações detidas < 365 dias');
});

test('saldo negativo não gera imposto', () => {
  reset();
  state.closed = [sale({ proceeds: 50 })];
  assert.equal(taxSummary(taxLines(), 2025).taxTotal, 0);
});

test('conta em USD: converte com o câmbio do BCE de cada data (dia útil anterior ao fim de semana)', () => {
  reset();
  state.cache.fxHist = { '2025-01-10': { USD: 1.25 }, '2025-06-06': { USD: 1.1 } };
  state.closed = [sale({ currency: 'USD', lots: [lot(10, 125, { date: '2025-01-10' })], proceeds: 165, closedAt: '2025-06-08' })];
  const [l] = taxLines();
  close(l.acqEUR, 100);
  close(l.saleEUR, 150);
  assert.equal(l.approxFx, false);
  assert.deepEqual(histRate('2025-06-08', 'USD'), { rate: 1.1, exact: true });

  state.cache.fxHist = {};
  const [approx] = taxLines();
  assert.equal(approx.approxFx, true, 'sem histórico usa o câmbio atual e avisa');
  close(approx.acqEUR, 100);
});

test('datas: usa a data de abertura quando o lote não tem data e assinala quando falta', () => {
  reset();
  state.closed = [
    sale({ id: 'a', lots: [lot(1, 10, { date: '' })], openedAt: '2025-02-01' }),
    sale({ id: 'b', lots: [lot(1, 10, { date: '' })] }),
  ];
  const lines = taxLines();
  assert.equal(lines.find(l => l.saleId === 'a').acqDate, '2025-02-01');
  const b = lines.find(l => l.saleId === 'b');
  assert.equal(b.missingDate, true);
  assert.equal(b.days, null);
  assert.equal(taxSummary(lines, 2025).missingDate, 1);
});

test('anos com vendas e ano por omissão (o anterior, que é o que se declara)', () => {
  reset();
  state.closed = [sale({ id: 'a', closedAt: '2024-03-01' }), sale({ id: 'b', closedAt: '2026-01-05' })];
  const years = taxYears(taxLines());
  assert.deepEqual(years, ['2026', '2024']);
  assert.equal(defaultTaxYear(years, new Date(2025, 4, 1)), '2024');
  assert.equal(defaultTaxYear(years, new Date(2026, 4, 1)), '2026');
});

test('CSV para Excel PT: BOM, ";" e vírgula decimal, sem fórmulas injetadas', () => {
  reset();
  state.closed = [sale({ name: '=HYPERLINK("x")', symbol: 'A;B', proceeds: 150.5 })];
  const csv = taxCSV(taxLines());
  assert.ok(csv.startsWith('﻿Ativo;Símbolo;Corretora'));
  const row = csv.split('\r\n')[1];
  assert.ok(row.startsWith(`"'=HYPERLINK(""x"")";"A;B";XTB;Ação/ETF;10;2025-01-10;100,00;2025-06-10;150,50;50,50;151;< 365 dias`), row);
});

test('câmbios históricos: um só pedido ao BCE para o intervalo necessário', async () => {
  reset();
  state.cache.fxHist = {};
  state.closed = [sale({ currency: 'USD', lots: [lot(1, 10, { date: '2025-01-10' })], closedAt: '2025-06-10' })];
  const calls = mockFetch([['frankfurter.app', { rates: { '2025-01-10': { USD: 1.03 }, '2025-06-10': { USD: 1.14 } } }]]);
  assert.equal(await ensureFxHistory(), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /2025-01-03\.\.2025-06-10\?from=EUR&to=USD/);
  assert.equal(state.cache.fxHist['2025-06-10'].USD, 1.14);
  assert.equal(await ensureFxHistory(), false, 'já tem tudo: não volta a pedir');

  state.closed = [sale()];
  assert.equal(await ensureFxHistory(), false, 'contas em EUR não precisam de câmbio');
});

test('ganhos de zero com resíduo de vírgula flutuante não contam como ganho de curto prazo', () => {
  reset();
  state.cache.fxHist = { '2025-02-03': { USD: 1.02 }, '2025-09-15': { USD: 1.17 } };
  state.closed = [sale({ currency: 'USD', lots: [lot(5, 1020, { date: '2025-02-03' })], proceeds: 1170, closedAt: '2025-09-15' })];
  assert.equal(taxSummary(taxLines(), 2025).shortTermGains, 0);
});
