import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, hydrate } from '../js/store.js';
import { cashBal, cashBreak, agg } from '../js/calc.js';
import { addDividend, removeDividend } from '../js/dividends.js';
import { creditCash, BROKER, OUT, saleDestinations, buySources, creditSale, debitBuy, dropCashRefs, saleCashLabel, brokerAccount, transferTargets, transferCash, transferPeer } from '../js/cash.js';
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
  assert.deepEqual(cashBreak(broker), { deposit: 0, interest: 0, sale: 300, buy: -300, transfer: 0, dividend: 0 });
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

test('transferir: do saldo da Revolut para o fundo de emergência e para investir na XTB', () => {
  reset();
  state.cash = [fund('em', 'Trade Republic', 2000)];
  creditSale(BROKER, { amount: 1500, currency: 'EUR', platform: 'Revolut', date: '2025-05-05', saleId: 'btc' });
  const rev = brokerAccount('Revolut', 'EUR');
  assert.deepEqual(transferTargets(rev.id).map(o => o.v), ['cash:em', 'broker:XTB', 'broker:Trade Republic']);
  const t1 = transferCash({ from: rev.id, to: 'cash:em', amount: 1000, date: '2025-05-06' });
  assert.equal(cashBal(state.cash.find(c => c.id === 'em')), 3000);
  assert.equal(cashBal(rev), 500);
  assert.equal(transferPeer(t1.ref, rev.id).id, 'em');
  const t2 = transferCash({ from: rev.id, to: 'broker:XTB', amount: 500, date: '2025-05-07' });
  assert.equal(t2.dst.label, 'Saldo XTB');
  assert.equal(cashBal(rev), 0);
  assert.equal(buySources('XTB', 'EUR').pick, `cash:${t2.dst.id}`, 'o dinheiro transferido fica pronto a investir');
  assert.deepEqual(cashBreak(rev), { deposit: 0, interest: 0, sale: 1500, buy: 0, transfer: -1500, dividend: 0 });
  assert.equal(agg('EUR').cashV, 3500, 'transferir não muda o património');
});

test('transferir: valida saldo e destino, converte moedas e desfaz os dois lados', () => {
  reset();
  state.cash = [fund('a', 'Revolut', 100), fund('u', 'XTB', 0, 'USD')];
  assert.throws(() => transferCash({ from: 'a', to: 'cash:u', amount: 150, date: '2025-01-02' }), /saldo/);
  assert.throws(() => transferCash({ from: 'a', to: 'cash:a', amount: 10, date: '2025-01-02' }), /destino/);
  assert.throws(() => transferCash({ from: 'a', to: 'cash:u', amount: 0, date: '2025-01-02' }), /valor/);
  const t = transferCash({ from: 'a', to: 'cash:u', amount: 80, date: '2025-01-02' });
  assert.equal(cashBal(state.cash[1]), 100, '80 EUR a 1,25 = 100 USD');
  const t2 = transferCash({ from: 'a', to: 'cash:u', amount: 20, received: 24.5, date: '2025-01-03' });
  assert.equal(t2.got, 24.5, 'valor recebido indicado à mão');
  debitBuy('cash:u', { amount: 110, currency: 'USD', platform: 'XTB', date: '2025-01-04', posId: 'p' });
  assert.equal(dropCashRefs(t.ref), 2);
  assert.equal(cashBal(state.cash[0]), 80);
  assert.equal(cashBal(state.cash[1]), 0, 'o que já tinha sido gasto passa a dinheiro novo');
});

test('dividendos: entram no saldo escolhido (na moeda da conta) e saem se forem apagados', () => {
  reset();
  const asset = { id: 'p1', name: 'Apple', symbol: 'AAPL', platform: 'XTB', currency: 'EUR' };
  const d = addDividend(asset, { date: '2025-08-14', gross: 12.5, withheld: 1.875, currency: 'USD' });
  const c = creditCash(BROKER, { amount: 10.625, currency: 'USD', accountCurrency: 'EUR', platform: 'XTB', date: d.date, ref: `div:${d.id}`, kind: 'dividend' });
  assert.equal(c.label, 'Saldo XTB');
  assert.equal(c.currency, 'EUR');
  assert.equal(cashBal(c), 8.5, '10,625 USD a 1,25 = 8,50 EUR');
  assert.equal(cashBreak(c).dividend, 8.5);
  removeDividend(d.id);
  assert.equal(state.dividends.length, 0);
  assert.equal(brokerAccount('XTB', 'EUR'), null, 'o saldo criado só para o dividendo desaparece');
});

test('dados guardados: tipos de movimento e ligações sobrevivem; tipos desconhecidos viram depósito', () => {
  hydrate({
    version: 2, positions: [], closed: [], alerts: [], history: [],
    cash: [{ id: 'b', label: 'Saldo XTB', currency: 'EUR', platform: 'XTB', broker: true, entries: [
      { amount: 10, kind: 'sale', date: '2025-01-01', ref: 'sale:x' }, { amount: -4, kind: 'buy', date: '2025-01-02', ref: 'pos:y' },
      { amount: 1, kind: 'xyz', date: '' }, { amount: 5, kind: 'transfer', date: '', ref: 'tr:1' },
    ] }],
  });
  const c = state.cash[0];
  assert.equal(c.broker, true);
  assert.deepEqual(c.entries.map(e => [e.kind, e.ref ?? null]), [['sale', 'sale:x'], ['buy', 'pos:y'], ['deposit', null], ['transfer', 'tr:1']]);
  assert.deepEqual(state.settings.cashDest, {});
});
