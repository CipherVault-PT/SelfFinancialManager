import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate } from '../js/store.js';
import { cashBal, cashBreak, agg } from '../js/calc.js';
import { BROKER, OUT, saleDestinations, buySources, creditSale, debitBuy, dropCashRefs, saleCashLabel, brokerAccount } from '../js/cash.js';
import { reset } from './helpers.js';

const fund = (id, platform, amount, currency = 'EUR') =>
  ({ id, label: 'Fundo de emergência', currency, platform, entries: [{ amount, kind: 'deposit', date: '2025-01-01' }] });

test('venda: por omissão fica na corretora, ou vai para o fundo dessa corretora', () => {
  reset();
  assert.equal(saleDestinations('XTB', 'EUR').pick, BROKER);
  state.cash = [fund('tr', 'Trade Republic', 1000)];
  assert.equal(saleDestinations('Trade Republic', 'EUR').pick, 'cash:tr');
  assert.equal(saleDestinations('XTB', 'EUR').pick, BROKER);
  const { opts } = saleDestinations('XTB', 'EUR');
  assert.deepEqual(opts.map(o => o.v), [BROKER, 'cash:tr', OUT]);
  state.settings.cashDest = { XTB: OUT };
  assert.equal(saleDestinations('XTB', 'EUR').pick, OUT, 'lembra a última escolha da corretora');
  state.settings.cashDest = { XTB: 'cash:apagado' };
  assert.equal(saleDestinations('XTB', 'EUR').pick, BROKER, 'escolha que já não existe é ignorada');
});

test('venda: credita o saldo da corretora (criado na hora) ou um fundo, com conversão', () => {
  reset();
  state.cash = [fund('tr', 'Trade Republic', 1000)];
  const c = creditSale(BROKER, { amount: 550, currency: 'EUR', platform: 'XTB', date: '2025-05-05', saleId: 's1' });
  assert.equal(c.label, 'Saldo XTB');
  assert.equal(c.broker, true);
  assert.deepEqual(c.entries, [{ amount: 550, kind: 'sale', date: '2025-05-05', ref: 'sale:s1' }]);
  assert.equal(state.settings.cashDest.XTB, BROKER);
  assert.equal(saleCashLabel('s1'), 'Saldo XTB');
  creditSale('cash:tr', { amount: 125, currency: 'USD', platform: 'Trade Republic', date: '2025-06-01', saleId: 's2' });
  assert.equal(cashBal(state.cash.find(x => x.id === 'tr')), 1100, '125 USD a 1,25 = 100 EUR');
  assert.equal(creditSale(OUT, { amount: 50, currency: 'EUR', platform: 'XTB', date: '2025-06-02', saleId: 's3' }), null);
  assert.equal(saleCashLabel('s3'), null);
  assert.equal(agg('EUR').cashV, 1650);
});

test('compra: usa o saldo da corretora se houver, até ao que existe', () => {
  reset();
  assert.equal(buySources('XTB', 'EUR').pick, 'new');
  creditSale(BROKER, { amount: 300, currency: 'EUR', platform: 'XTB', date: '2025-05-05', saleId: 's1' });
  const broker = brokerAccount('XTB', 'EUR');
  assert.equal(buySources('XTB', 'EUR').pick, `cash:${broker.id}`);
  assert.equal(buySources('Revolut', 'EUR').pick, 'new', 'o saldo da XTB não é sugerido para a Revolut');
  assert.equal(debitBuy(`cash:${broker.id}`, { amount: 200, currency: 'EUR', platform: 'XTB', date: '2025-05-06', posId: 'p1' }), 200);
  assert.equal(cashBal(broker), 100);
  assert.equal(debitBuy(`cash:${broker.id}`, { amount: 250, currency: 'EUR', platform: 'XTB', date: '2025-05-07', posId: 'p2' }), 100, 'o resto é dinheiro novo');
  assert.equal(cashBal(broker), 0);
  assert.equal(debitBuy('new', { amount: 100, currency: 'EUR', platform: 'XTB', date: '2025-05-08', posId: 'p3' }), 0);
  assert.equal(buySources('XTB', 'EUR').opts.length, 1, 'saldos a zero não aparecem');
  assert.deepEqual(cashBreak(broker), { deposit: 0, interest: 0, sale: 300, buy: -300 });
});

test('anular venda / apagar posição desfaz os movimentos; saldo da corretora vazio desaparece', () => {
  reset();
  state.cash = [fund('tr', 'Trade Republic', 1000)];
  creditSale(BROKER, { amount: 300, currency: 'EUR', platform: 'XTB', date: '2025-05-05', saleId: 's1' });
  creditSale('cash:tr', { amount: 200, currency: 'EUR', platform: 'Trade Republic', date: '2025-05-05', saleId: 's2' });
  debitBuy('cash:tr', { amount: 50, currency: 'EUR', platform: 'Trade Republic', date: '2025-05-06', posId: 'p9' });
  assert.equal(dropCashRefs('sale:s1'), 1);
  assert.equal(brokerAccount('XTB', 'EUR'), null);
  assert.equal(dropCashRefs('pos:p9'), 1);
  assert.equal(cashBal(state.cash[0]), 1200);
  assert.equal(dropCashRefs('sale:s2'), 1);
  assert.equal(state.cash.length, 1, 'fundos normais ficam, mesmo que só com o depósito');
});

test('anular uma venda cujo dinheiro já foi usado: a compra passa a ser dinheiro novo', () => {
  reset();
  creditSale(BROKER, { amount: 300, currency: 'EUR', platform: 'XTB', date: '2025-05-05', saleId: 's1' });
  creditSale(BROKER, { amount: 100, currency: 'EUR', platform: 'XTB', date: '2025-05-06', saleId: 's2' });
  const id = `cash:${brokerAccount('XTB', 'EUR').id}`;
  debitBuy(id, { amount: 250, currency: 'EUR', platform: 'XTB', date: '2025-05-07', posId: 'p1' });
  dropCashRefs('sale:s1');
  const b = brokerAccount('XTB', 'EUR');
  assert.equal(cashBal(b), 0);
  assert.deepEqual(b.entries.map(e => [e.kind, e.amount]), [['sale', 100], ['buy', -100]]);
  dropCashRefs('sale:s2');
  assert.equal(brokerAccount('XTB', 'EUR'), null);
});

test('dados guardados: tipos de movimento e ligações sobrevivem; tipos desconhecidos viram depósito', () => {
  hydrate({
    version: 2, positions: [], closed: [], alerts: [], history: [],
    cash: [{ id: 'b', label: 'Saldo XTB', currency: 'EUR', platform: 'XTB', broker: true, entries: [
      { amount: 10, kind: 'sale', date: '2025-01-01', ref: 'sale:x' }, { amount: -4, kind: 'buy', date: '2025-01-02', ref: 'pos:y' },
      { amount: 1, kind: 'xyz', date: '' },
    ] }],
  });
  const c = state.cash[0];
  assert.equal(c.broker, true);
  assert.deepEqual(c.entries.map(e => [e.kind, e.ref ?? null]), [['sale', 'sale:x'], ['buy', 'pos:y'], ['deposit', null]]);
  assert.deepEqual(state.settings.cashDest, {});
});
