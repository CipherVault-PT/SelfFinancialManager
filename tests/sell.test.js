import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { sellFIFO, mergeLots, closedM, qty, pCost, agg } from '../js/calc.js';
import { reset, lot, stockPos } from './helpers.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const sum = (lots, k) => lots.reduce((s, l) => s + l[k], 0);

test('FIFO: vende primeiro as compras mais antigas, mesmo que registadas depois', () => {
  const lots = [lot(10, 1000, { date: '2025-03-01' }), lot(5, 400, { date: '2025-01-15' })];
  const { sold, remaining } = sellFIFO(lots, 7);
  assert.deepEqual(sold.map(l => [l.date, l.shares]), [['2025-01-15', 5], ['2025-03-01', 2]]);
  close(sum(sold, 'cost'), 400 + 200);
  assert.deepEqual(remaining.map(l => [l.date, l.shares]), [['2025-03-01', 8]]);
  close(remaining[0].cost, 800);
  assert.equal(lots[0].shares, 10, 'não altera as entradas originais');
});

test('FIFO: venda total esvazia as entradas sem resíduos de arredondamento', () => {
  const lots = [lot(0.1, 10, { date: '2025-01-01' }), lot(0.2, 30, { date: '2025-02-01' })];
  const { sold, remaining } = sellFIFO(lots, 0.1 + 0.2);
  assert.equal(remaining.length, 0);
  assert.equal(sold.length, 2);
  close(sum(sold, 'cost'), 40);
});

test('FIFO: entradas sem data usam a data de abertura e mantêm a ordem', () => {
  const lots = [lot(1, 10, { date: '' }), lot(1, 20, { date: '' }), lot(1, 30, { date: '2020-01-01' })];
  const { sold } = sellFIFO(lots, 2, '2024-06-01');
  assert.deepEqual(sold.map(l => l.cost), [30, 10]);
});

test('venda parcial: resultado realizado pelo custo FIFO e posição restante correta', () => {
  reset();
  const p = stockPos({ quoteCur: 'EUR', lots: [lot(10, 100, { date: '2025-01-01' }), lot(10, 200, { date: '2025-02-01' })] });
  state.positions = [p];
  const { sold, remaining } = sellFIFO(p.lots, 15);
  const sale = { ...p, id: 's1', parentId: p.id, partial: true, lots: sold, proceeds: 270, exitPrice: 18, exitCur: 'EUR' };
  p.lots = remaining;
  state.closed = [sale];
  const m = closedM(sale, 'EUR');
  assert.equal(m.u, 15);
  close(pCost(sale), 100 + 100);
  close(m.pl, 70);
  assert.equal(qty(p), 5);
  close(pCost(p), 100);
  close(agg('EUR').realized, 70);
});

test('anular venda: as frações voltam a juntar-se ao lote original', () => {
  const lots = [lot(10, 120, { date: '2025-01-10' }), lot(10, 100, { date: '2025-03-01' })];
  const first = sellFIFO(lots, 12);
  const second = sellFIFO(first.remaining, 8);
  const back = mergeLots(mergeLots(second.remaining, second.sold), first.sold);
  assert.deepEqual(back.map(l => [l.date, l.shares]), [['2025-01-10', 10], ['2025-03-01', 10]]);
  close(sum(back, 'cost'), 220);
});
