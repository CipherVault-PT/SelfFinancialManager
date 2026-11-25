import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { isRevolut, parseRevolut, resolveCoins, fixText, euroNum, quantity } from '../js/import/revolut.js';
import { parseCsv } from '../js/import/csv.js';
import { planImport, applyImport } from '../js/import/apply.js';
import { reset } from './helpers.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
// a exportação real vem codificada duas vezes (UTF-8 lido como Latin-1, duas vezes)
const garble = s => Buffer.from(Buffer.from(Buffer.from(s, 'utf8').toString('latin1'), 'utf8').toString('latin1'), 'utf8').toString('utf8');
const twice = s => Buffer.from(Buffer.from(s, 'utf8').toString('latin1'), 'utf8').toString('latin1');
const NB = ' ';
const row = (sym, type, qty, price, value, fee, date) => [sym, twice(type), `"${qty}"`, `"${twice(price)}"`, `"${twice(value)}"`, `"${twice(fee)}"`, `"${date}"`].join(',');

// moedas inventadas: ZZB (cara, quantidades pequenas sem vírgula, como na exportação) e ZZX (barata)
const CSV = ['Symbol,Type,Quantity,Price,Value,Fees,Date',
  row('ZZB', 'Compra', '50,000', `10${NB}000,00€`, '50,00€', '1,00€', '10/01/2025, 10:00:00'),
  row('ZZB', 'Compra', '25,000', `20${NB}000,00€`, '50,00€', '1,00€', '10/02/2025, 10:00:00'),
  row('ZZX', 'Compra', `1${NB}000${NB}000,5`, '0,00€', '20,00€', '1,00€', '01/03/2025, 9:00:00'),
  row('ZZB', 'Receção', '10,000', `30${NB}000,00€`, '30,00€', '0,00€', '05/03/2025, 12:00:00'),
  row('ZZB', 'Venda', '60,000', `40${NB}000,00€`, '240,00€', '2,00€', '01/04/2025, 15:30:00'),
  row('ZZX', 'Venda', `400${NB}000`, '0,00€', '12,00€', '0,50€', '02/04/2025, 1:00:00'),
  row('EUR', 'Outro', '', '', '80,00€', '0,00€', '31/12/2025, 16:54:40'),
  row('ZZB', 'Comprar - Revolut X', '12,500', `40${NB}000,00€`, '50,00€', '0,05€', '31/12/2025, 16:55:51'),
].join('\r\n');

test('Revolut: texto codificado duas vezes, números com espaço e vírgula, quantidades sem vírgula', () => {
  assert.equal(fixText(garble('Receção')), 'Receção');
  assert.equal(fixText('Venda'), 'Venda');
  assert.equal(euroNum(garble(`12${NB}345,67€`)), 12345.67);
  assert.ok(Number.isNaN(euroNum('31,415,926')));
  close(quantity('45,678', 29.69, 65000), 0.00045678, 1e-12);
  close(quantity('31,415,926', 9.42, 0.3), 31.415926);
  close(quantity('702,156', 21.06, 3), 7.02156);
  close(quantity('271', 0.05, 18450), 0.00000271, 1e-15);
  assert.equal(quantity('1,5', 3000, 2000), 1.5, 'quando bate certo, fica');
  close(quantity(`3${NB}141${NB}592,6535`, 20, 0), 3141592.6535, 1e-4);
  assert.ok(isRevolut(parseCsv(CSV)));
  assert.ok(!isRevolut(parseCsv('a,b\n1,2')));
});

test('Revolut: FIFO com comissões, receções pelo valor (aproximado) e EUR de fora', () => {
  const s = parseRevolut(CSV, { modified: Date.parse('2026-02-01T10:00:00Z') });
  assert.deepEqual([s.broker, s.kind, s.currency, s.period.from, s.period.to, s.snapshot], ['Revolut', 'crypto', 'EUR', '2025-01-10', '2025-12-31', '2026-02-01']);
  // venda de 0,006 ZZB: 0,005 da 1.ª compra e 0,001 da 2.ª
  const zzb = s.closed.filter(r => r.symbol === 'ZZB');
  assert.deepEqual(zzb.map(r => [r.date, +r.units.toFixed(9)]), [['2025-01-10', 0.005], ['2025-02-10', 0.001]]);
  close(zzb[0].cost, 51); close(zzb[1].cost, 51 * 0.4);
  close(zzb[0].proceeds + zzb[1].proceeds, 238);
  assert.equal(zzb[0].closePrice, 40000);
  const open = s.open.filter(r => r.symbol === 'ZZB');
  assert.deepEqual(open.map(r => +r.units.toFixed(9)), [0.0015, 0.001, 0.00125]);
  assert.equal(open[1].date, '2025-03-05');
  close(open[1].cost, 30, 1e-9);
  assert.deepEqual(s.approx.map(a => [a.symbol, a.cost]), [['ZZB', 30]]);
  const x = s.closed.find(r => r.symbol === 'ZZX');
  close(x.units, 400000); close(x.cost, 21 * 400000 / 1000000.5, 1e-6); close(x.proceeds, 11.5);
  assert.deepEqual([s.ignored, s.missing.length], [0, 0]);
  assert.ok(s.open.every(r => r.priceCur === 'EUR' && !r.coin));
});

test('Revolut: id da CoinGecko pelo que já está na app ou pela pesquisa (símbolo exato, maior capitalização)', async () => {
  const s = await resolveCoins(parseRevolut(CSV), {
    known: { ZZB: { id: 'zz-b', name: 'Moeda B', thumb: 'b.png' } },
    search: sym => (sym === 'ZZX' ? [{ id: 'zz-x-fake', symbol: 'zzx', name: 'Falsa', rank: 900 }, { id: 'zz-x', symbol: 'ZZX', name: 'Moeda X', rank: 50 }, { id: 'zzxy', symbol: 'zzxy', rank: 1 }] : []),
  });
  assert.deepEqual([...new Set(s.open.map(r => `${r.symbol}:${r.coin}:${r.name}`))].sort(), ['ZZB:zz-b:Moeda B', 'ZZX:zz-x:Moeda X']);
  assert.deepEqual(s.unresolved, []);
  const off = await resolveCoins(parseRevolut(CSV), { search: () => { throw new Error('offline'); } });
  assert.deepEqual(off.unresolved.sort(), ['ZZB', 'ZZX']);
});

test('Revolut → app: substitui as cripto registadas à mão, mantém alertas e as outras corretoras, não duplica', async () => {
  reset();
  state.positions = [
    { id: 'c1', kind: 'crypto', platform: 'Revolut', currency: 'EUR', name: 'Moeda B', symbol: 'ZZB', coingeckoId: 'zz-b', lots: [{ shares: 0.004, cost: 120, date: '2025-06-01' }] },
    { id: 's1', kind: 'stock', platform: 'Revolut', currency: 'EUR', name: 'Ação', quoteSymbol: 'ZZS.DE', quoteCur: 'EUR', lots: [{ shares: 1, cost: 10, date: '2025-01-01' }] },
    { id: 'c2', kind: 'crypto', platform: 'Outra', currency: 'EUR', name: 'Moeda B', symbol: 'ZZB', coingeckoId: 'zz-b', lots: [{ shares: 1, cost: 1, date: '2025-01-01' }] },
  ];
  state.alerts = [{ id: 'a', posId: 'c1', price: 1, dir: 'above' }];
  const s = await resolveCoins(parseRevolut(CSV, { modified: Date.parse('2026-02-01T10:00:00Z') }), { known: { ZZB: { id: 'zz-b' } }, search: () => [{ id: 'zz-x', symbol: 'zzx', rank: 5 }] });
  applyImport(planImport(s, { replace: true }));
  const b = state.positions.find(p => p.id === 'c1');
  assert.equal(b.lots.length, 3, 'lote manual trocado pelos do extrato');
  assert.ok(b.lots.every(l => l.src?.startsWith('rvo:')));
  assert.equal(state.alerts.length, 1);
  const x = state.positions.find(p => p.coingeckoId === 'zz-x');
  assert.deepEqual([x.kind, x.platform, x.symbol, x.currency], ['crypto', 'Revolut', 'ZZX', 'EUR']);
  assert.equal(state.positions.find(p => p.id === 's1').lots.length, 1, 'ações da Revolut não mudam');
  assert.equal(state.positions.find(p => p.id === 'c2').lots.length, 1, 'outras corretoras não mudam');
  const sale = state.closed.find(c => c.coingeckoId === 'zz-b');
  assert.deepEqual([sale.kind, sale.exitCur, sale.lots.length, sale.parentId], ['crypto', 'EUR', 2, 'c1']);
  assert.equal(planImport(s).summary.changes, 0, 'reimportar não duplica');
});
