import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate, exportJSON, normalizeJournal } from '../js/store.js';
import { tradeStats, insights, holdDays, inPeriod, distance } from '../js/journal.js';
import { reset, lot } from './helpers.js';

/** Venda inventada: custo, recebido, data de compra e de venda. */
const sale = (id, cost, proceeds, bought, sold, extra = {}) => ({
  id, kind: 'stock', name: `Trade ${id}`, platform: 'XTB', currency: 'EUR', lots: [lot(1, cost, { date: bought })],
  proceeds, closedAt: sold, ...extra,
});

test('diário: normaliza tese, alvo e stop; descarta vazios', () => {
  assert.equal(normalizeJournal(null), null);
  assert.equal(normalizeJournal({ thesis: '', target: 0, stop: -1 }), null);
  assert.deepEqual(normalizeJournal({ thesis: 'teste', target: '120', stop: 'x', cur: 'USD' }), { thesis: 'teste', target: 120, stop: null, cur: 'USD' });
  reset();
  hydrate({
    version: 2,
    positions: [{ id: 'a', kind: 'stock', name: 'A', currency: 'EUR', lots: [lot(1, 10)], journal: { thesis: 'x', target: 12 }, note: '  ' }],
    closed: [sale('s', 10, 12, '2026-01-02', '2026-02-02', { journal: { target: 0 }, note: ' aprendi ' })],
  });
  assert.deepEqual(state.positions[0].journal, { thesis: 'x', target: 12, stop: null, cur: null });
  assert.equal('note' in state.positions[0], false);
  assert.equal('journal' in state.closed[0], false);
  assert.equal(state.closed[0].note, 'aprendi');
  assert.equal(JSON.parse(exportJSON()).closed[0].note, 'aprendi', 'vai no backup e na sincronização');
});

test('diário: dias na carteira pesados pelo custo e períodos', () => {
  const c = { closedAt: '2026-03-01', openedAt: '2026-01-01', lots: [lot(1, 100, { date: '2026-02-01' }), lot(1, 300, { date: '' })] };
  assert.equal(holdDays(c), Math.round((100 * 28 + 300 * 59) / 400));
  assert.equal(holdDays({ closedAt: '', lots: [] }), null);
  const now = new Date('2026-10-16T12:00:00Z');
  assert.equal(inPeriod({ closedAt: '2026-01-05' }, 'year', now), true);
  assert.equal(inPeriod({ closedAt: '2025-12-31' }, 'year', now), false);
  assert.equal(inPeriod({ closedAt: '2025-12-31' }, '12m', now), true);
  assert.equal(inPeriod({ closedAt: '2025-10-01' }, '12m', now), false);
  assert.equal(distance(110, 100), 10);
  assert.equal(distance(null, 100), null);
});

test('diário: acerto, ganho/perda médios, profit factor, tempo, melhor e pior', () => {
  reset();
  state.closed = [
    sale('a', 100, 130, '2026-01-01', '2026-01-11'), // +30 em 10 dias
    sale('b', 100, 110, '2026-02-01', '2026-02-06'), // +10 em 5 dias
    sale('c', 100, 80, '2026-01-01', '2026-03-02'), // −20 em 60 dias
    sale('d', 200, 180, '2026-03-01', '2026-03-31'), // −20 em 30 dias
    sale('e', 100, 100, '2026-04-01', '2026-04-02'), // 0
    sale('old', 100, 500, '2024-01-01', '2024-06-01'),
  ];
  const now = new Date('2026-10-16T12:00:00Z');
  const st = tradeStats(state.closed, { period: 'year', cur: 'EUR', now });
  assert.deepEqual([st.n, st.wins, st.losses, st.winRate], [5, 2, 2, 40]);
  assert.deepEqual([st.avgWin, st.avgLoss, st.payoff, st.profitFactor, st.total, st.expectancy], [20, -20, 1, 1, 0, 0]);
  assert.deepEqual([st.avgWinPct, st.avgLossPct], [20, -15]);
  assert.deepEqual([st.avgDaysWin, st.avgDaysLoss], [7.5, 45]);
  assert.deepEqual([st.best.c.id, st.worst.c.id], ['a', 'c']);
  assert.equal(tradeStats(state.closed, { period: 'all', cur: 'EUR', now }).n, 6);
  const notes = insights(st);
  assert.ok(notes.some(x => x.includes('Seguras as perdas 45 dias e os ganhos só 8')));
  assert.ok(notes.some(x => x.includes('mais de 50%') && x.includes('40%')));
  assert.deepEqual(insights({ ...st, n: 4 }), [], 'amostra pequena: sem conclusões');
});

test('diário: sem perdas o profit factor é infinito; sem vendas fica vazio', () => {
  reset();
  state.closed = [sale('a', 100, 150, '2026-01-01', '2026-01-02')];
  const st = tradeStats(state.closed, { cur: 'EUR' });
  assert.equal(st.profitFactor, Infinity);
  assert.equal(st.payoff, null);
  assert.equal(st.worst, null);
  const none = tradeStats([], { cur: 'EUR' });
  assert.deepEqual([none.n, none.winRate, none.expectancy], [0, null, null]);
});
