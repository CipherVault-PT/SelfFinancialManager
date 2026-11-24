import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { parseCsv } from '../js/import/csv.js';
import { isTr, parseTr, resolveIsins, pickListing } from '../js/import/tr.js';
import { planImport, applyImport } from '../js/import/apply.js';
import { reset } from './helpers.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const HEAD = 'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
const line = (dt, cat, type, cls, name, isin, shares, price, amount, fee, tax, desc, id, who = '', iban = '') =>
  [`${dt}T10:00:00Z`, dt, 'DEFAULT', cat, type, cls, name, isin, shares, price, amount, fee, tax, 'EUR', '', '', '', desc, id, who, iban, '', '']
    .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');

// dados inventados: duas ações fictícias (ISIN US… e PT…), um ETF da base local (ISIN real, conhecido) e uma pessoa fictícia
const ROWS = [
  line('2026-01-05', 'CASH', 'VIBAN_TRANSFER_INBOUND', '', 'Fulano de Tal', '', '', '', '1000.00', '', '', 'Incoming transfer', 't1', 'Fulano de Tal', 'PT50000000000000000000000'),
  line('2026-01-06', 'TRADING', 'BUY', 'FUND', 'Core S&P 500 USD (Acc)', 'IE00B5BMR087', '0.0200000000', '500.00', '-10.00', '', '', 'Savings plan execution IE00B5BMR087', 't2'),
  line('2026-01-10', 'TRADING', 'BUY', 'STOCK', 'Empresa Inventada A', 'US0000000ZZ1', '10.0000000000', '20.00', '-200.00', '-1.00', '', 'Buy trade', 't3'),
  line('2026-02-10', 'TRADING', 'BUY', 'STOCK', 'Empresa Inventada A', 'US0000000ZZ1', '10.0000000000', '25.00', '-250.00', '-1.00', '-0.04', 'Buy trade', 't4'),
  line('2026-03-02', 'CASH', 'INTEREST_PAYMENT', '', '', '', '', '', '1.50', '', '', 'Interest payment', 't5'),
  line('2026-03-10', 'TRADING', 'SELL', 'STOCK', 'Empresa Inventada A', 'US0000000ZZ1', '-15.0000000000', '30.00', '450.00', '-1.00', '-0.04', 'Sell trade', 't6'),
  line('2026-04-01', 'DELIVERY', 'MIGRATION', 'FUND', 'Core S&P 500 USD (Acc)', 'IE00B5BMR087', '-0.0500000000', '400.00', '', '', '', 'MIGRATION', 't7'),
  line('2026-04-01', 'DELIVERY', 'MIGRATION', 'FUND', 'Core S&P 500 USD (Acc)', 'IE00B5BMR087', '0.0500000000', '400.00', '', '', '', 'MIGRATION', 't8'),
  line('2026-05-04', 'TRADING', 'BUY', 'STOCK', 'Empresa Portuguesa Inventada', 'PTZZZ0AM0001', '100.0000000000', '3.00', '-300.00', '-1.00', '-0.04', 'Buy trade', 't9'),
  line('2026-05-05', 'CASH', 'DIVIDEND', 'STOCK', 'Empresa Inventada A', 'US0000000ZZ1', '', '', '0.85', '', '-0.15', 'Dividend', 't10'),
  line('2026-05-06', 'TRADING', 'BUY', 'CRYPTO', 'Moeda Inventada', 'XF000ZZC0001', '1', '10', '-10.00', '-1.00', '', 'Buy trade', 't11'),
  line('2026-05-07', 'CASH', 'VIBAN_TRANSFER_OUTBOUND', '', 'Fulano de Tal', '', '', '', '-200.00', '', '', 'Outgoing transfer', 't12', 'Fulano de Tal', 'PT50000000000000000000000'),
];
const CSV = [HEAD, ...ROWS].join('\n');
const NAME = 'transactions_2026-01-01_2026-06-30.csv';

const fakeSearch = isin => ({
  US0000000ZZ1: [{ y: 'ZZA', t: 'ZZA', n: 'Empresa A', x: 'NASDAQ', c: 'USD' }, { y: 'US0000000ZZ1.SG', t: 'x', c: 'EUR' }],
  PTZZZ0AM0001: [{ y: 'ZZP.F', t: 'ZZP', c: 'EUR' }, { y: 'ZZP.LS', t: 'ZZP', c: 'EUR' }],
}[isin] ?? []);

test('CSV: aspas, vírgulas dentro de campos e ponto e vírgula', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","diz ""olá"""\r\n'), [['a', 'b'], ['x, y', 'diz "olá"']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.ok(isTr(parseCsv(CSV)));
  assert.ok(!isTr(parseCsv('a,b\n1,2')));
});

test('Trade Republic: FIFO com comissões, plano, migração, dividendo e juros; nada de nomes nem IBAN', () => {
  const s = parseTr(CSV, { name: NAME });
  assert.deepEqual([s.broker, s.currency, s.period.from, s.period.to, s.snapshot], ['Trade Republic', 'EUR', '2026-01-01', '2026-06-30', '2026-06-30']);
  // venda de 15: as 10 da 1.ª compra e 5 da 2.ª
  assert.deepEqual(s.closed.map(r => [r.id, r.units]), [['t3', 10], ['t4', 5]]);
  close(s.closed[0].cost, 201);
  close(s.closed[1].cost, 251.04 / 2);
  close(s.closed[0].proceeds + s.closed[1].proceeds, 450 - 1.04);
  assert.equal(s.closed[0].closePrice, 30);
  assert.equal(s.closed[0].priceCur, 'EUR');
  const a = s.open.find(r => r.isin === 'US0000000ZZ1');
  close(a.units, 5); close(a.cost, 251.04 / 2);
  // a migração mostra 0,05 un. do ETF, mas só há 0,02 compradas no ficheiro: 0,03 vêm de antes
  const etf = s.open.filter(r => r.isin === 'IE00B5BMR087');
  assert.deepEqual(etf.map(r => r.id), ['pre:IE00B5BMR087', 't2']);
  close(etf[0].units, 0.03); close(etf[0].cost, 0.05 * 400 - 10);
  assert.equal(etf[0].date, '2025-12-31');
  assert.equal(s.approx.length, 1);
  assert.deepEqual(s.dividends.map(d => [d.isin, d.gross, d.withheld]), [['US0000000ZZ1', 1, 0.15]]);
  assert.deepEqual([s.interest.gross, s.deposits, s.withdrawals, s.ignored], [1.5, 1000, 200, 1]);
  assert.ok(!JSON.stringify(s).includes('Fulano') && !JSON.stringify(s).includes('PT5000'), 'não guarda nomes nem IBAN');
});

test('Trade Republic: venda sem as compras no ficheiro fica assinalada', () => {
  const s = parseTr([HEAD, line('2026-03-10', 'TRADING', 'SELL', 'STOCK', 'Empresa Inventada A', 'US0000000ZZ1', '-3', '30.00', '90.00', '-1.00', '', 'Sell trade', 'x1')].join('\n'));
  assert.equal(s.closed.length, 0);
  assert.deepEqual(s.missing.map(m => [m.isin, m.units]), [['US0000000ZZ1', 3]]);
  assert.throws(() => parseTr('a,b\n1,2'), /Trade Republic/);
});

test('ISIN → Yahoo: EUA na bolsa americana, os outros na de casa ou na Xetra; ETFs da base local primeiro', async () => {
  assert.equal(pickListing('US0000000ZZ1', fakeSearch('US0000000ZZ1')).y, 'ZZA');
  assert.equal(pickListing('PTZZZ0AM0001', fakeSearch('PTZZZ0AM0001')).y, 'ZZP.LS');
  assert.equal(pickListing('IE0000000ZZ9', [{ y: 'ZZE.L' }, { y: 'ZZE.DE' }]).y, 'ZZE.DE');
  assert.equal(pickListing('KY0000000ZZ0', [{ y: '0000.HK' }]).y, '0000.HK');
  assert.equal(pickListing('US0000000ZZ1', []), null);
  const s = await resolveIsins(parseTr(CSV, { name: NAME }), fakeSearch);
  const etf = s.open.find(r => r.isin === 'IE00B5BMR087');
  assert.deepEqual([etf.y, etf.quoteCur], ['SXR8.DE', 'EUR'], 'base local, em euros');
  const a = s.open.find(r => r.isin === 'US0000000ZZ1');
  assert.deepEqual([a.y, a.quoteCur, a.priceCur], ['ZZA', 'USD', 'EUR']);
  assert.deepEqual(s.unresolved, []);
  const off = await resolveIsins(parseTr(CSV, { name: NAME }), () => { throw new Error('offline'); });
  assert.deepEqual(off.unresolved.sort(), ['Empresa Inventada A', 'Empresa Portuguesa Inventada']);
});

test('Trade Republic → app: substitui o registado à mão, reconhece o ETF pelo ISIN noutra bolsa e não duplica', async () => {
  reset();
  state.positions = [
    { id: 'm1', kind: 'stock', platform: 'Trade Republic', currency: 'EUR', name: 'ETF manual', quoteSymbol: 'CSPX.L', quoteCur: 'USD',
      plan: { amount: 10, day: 2 }, lots: [{ shares: 0.04, cost: 18, date: '2026-01-02' }] },
    { id: 'c1', kind: 'crypto', platform: 'Revolut', currency: 'EUR', name: 'Cripto', symbol: 'ZZC', coingeckoId: 'zz', lots: [{ shares: 1, cost: 100, date: '2025-01-01' }] },
  ];
  const s = await resolveIsins(parseTr(CSV, { name: NAME }), fakeSearch);
  applyImport(planImport(s, { replace: true }));
  const etf = state.positions.find(p => p.id === 'm1');
  assert.deepEqual(etf.lots.map(l => l.src), ['tro:pre:IE00B5BMR087', 'tro:t2'], 'lote manual trocado pelos do extrato');
  assert.deepEqual(etf.plan, { amount: 10, day: 2 }, 'o plano fica');
  const a = state.positions.find(p => p.quoteSymbol === 'ZZA');
  assert.deepEqual([a.platform, a.currency, a.isin, a.lots[0].priceCur], ['Trade Republic', 'EUR', 'US0000000ZZ1', 'EUR']);
  const sale = state.closed.find(c => c.quoteSymbol === 'ZZA');
  assert.deepEqual([sale.lots.length, sale.exitCur, sale.parentId], [2, 'EUR', a.id]);
  close(sale.exitPrice, 30);
  assert.equal(state.dividends[0].posId, a.id);
  assert.ok(state.positions.some(p => p.id === 'c1'), 'a cripto da Revolut fica');
  assert.equal(planImport(await resolveIsins(parseTr(CSV, { name: NAME }), fakeSearch)).summary.changes, 0);
});
