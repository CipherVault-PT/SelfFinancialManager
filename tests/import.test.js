import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { state } from '../js/store.js';
import { readXlsx, parseSheet, colIndex, excelDate } from '../js/import/xlsx.js';
import { xtbToYahoo, guessQuoteCur, parseXtb, isXtb } from '../js/import/xtb.js';
import { planImport, applyImport, manualCount } from '../js/import/apply.js';
import { reset, memoryStorage } from './helpers.js';

/* ---------- gerar um .xlsx em memória ---------- */

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), nm = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(head, nm, data); central.push(cd, nm);
    offset += 30 + nm.length + data.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...parts, cdBuf, end]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

function makeXlsx(sheets, { shared = false } = {}) {
  const strings = [];
  const sheetXml = rows => `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    if (v == null || v === '') return '';
    const ref = `${colName(j)}${i + 1}`;
    if (typeof v === 'number') return `<c r="${ref}" s="3"><v>${v}</v></c>`;
    if (shared) { strings.push(v); return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`; }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const names = Object.keys(sheets);
  const files = {
    'xl/workbook.xml': `<workbook><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml" Type="x"/>`).join('')}</Relationships>`,
  };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n]); });
  if (shared) files['xl/sharedStrings.xml'] = `<sst>${strings.map(s => `<si><t>${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  return zip(files);
}

/* ---------- extrato XTB fictício (mesma estrutura do real) ---------- */

const serial = iso => Date.parse(`${iso}T00:00:00Z`) / 86_400_000 + 25569;
const at = (iso, h = 10) => serial(iso) + h / 24;
const head = [[], [], [], [], [null, null, null, 'Name and surname', 'Account', 'Currency', null, 45000.5],
  [null, null, null, 'Fulano de Tal', '123', 'EUR'], [null, null, null, 'Balance', 'Equity'], [null, null, null, 10, 2000]];

function xtbSheets({ open = [], closed = [], cash = [] } = {}) {
  return {
    'CLOSED POSITION HISTORY': [...head, [null, 'CLOSED POSITION HISTORY '], [null, '01/01/2025 - 01/01/2026'],
      [null, 'Position', 'Symbol', 'Type', 'Volume', 'Open time', 'Open price', 'Close time', 'Close price', 'Open origin', 'Close origin', 'Purchase value', 'Sale value', 'SL', 'TP', 'Margin', 'Commission', 'Swap', 'Rollover', 'Gross P/L', 'Comment'],
      ...closed, [null, 'Total', null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, -5]],
    'OPEN POSITION 01012026': [...head, [null, 'OPEN POSITION HISTORY '], [null, 46023],
      [null, 'Position', 'Symbol', 'Type', 'Volume', 'Open time', 'Open price', 'Market price', 'Purchase value', 'SL', 'TP', 'Margin', 'Commission', 'Swap', 'Rollover', 'Gross P/L', 'Comment'],
      ...open, [null, 'Total']],
    'CASH OPERATION HISTORY': [...head, [null, 'CASH OPERATION HISTORY '], [null, '01/01/2025 - 01/01/2026'],
      [null, 'ID', 'Type', 'Time', 'Comment', 'Symbol', 'Amount'], ...cash, [null, 'Total', null, null, null, null, 3.44, 'EUR']],
  };
}

const O = (id, sym, units, price, date, cost, mkt) => [null, id, sym, 'BUY', units, at(date), price, mkt, cost, null, null, 0, 0, 0, 0, 1];
const C = (id, sym, units, price, date, cost, closeDate, cp, proceeds, h = 15) =>
  [null, id, sym, 'BUY', units, at(date), price, at(closeDate, h), cp, 'x', 'x', cost, proceeds, null, null, null, 0, 0, 0, proceeds - cost];
const CFD = (id, sym, pl) => [null, id, sym, 'BUY', 0.01, at('2025-02-03'), 90000, at('2025-02-04'), 91000, 'x', 'x', null, null, null, null, 500, 0, -1, 0, pl];
const K = (id, type, date, comment, sym, amount) => [null, id, type, at(date), comment, sym, amount];

const SAMPLE = {
  open: [
    O(11, 'VUAA.DE', 2, 95, '2025-04-15', 190.1, 112.7), O(12, 'VUAA.DE', 0.5, 120, '2025-07-21', 60, 112.7),
    O(13, 'AAPL.US', 2, 200, '2025-06-02', 342.86, 250),
  ],
  closed: [
    C(21, 'EDP.PT', 1000, 3.5, '2025-03-03', 3500, '2025-05-05', 3.7, 3700),
    C(22, 'EDP.PT', 500, 3.6, '2025-03-10', 1800, '2025-05-05', 3.7, 1850),
    C(23, 'NVDA.US', 1, 117, '2025-01-27', 109.35, '2025-02-10', 120, 110.6),
    CFD(31, 'BITCOIN', 20), CFD(32, 'GOLD', -50),
  ],
  cash: [
    K(41, 'deposit', '2025-01-02', 'Card deposit', null, 5000),
    K(42, 'Stock purchase', '2025-03-03', 'OPEN BUY 1000 @ 3.5', 'EDP.PT', -3500),
    K(43, 'DIVIDENT', '2025-08-14', 'AAPL.US USD 0.2600/ SHR', 'AAPL.US', 0.45),
    K(44, 'Withholding Tax', '2025-08-14', 'AAPL.US USD WHT 15%', 'AAPL.US', -0.07),
    K(45, 'Free-funds Interest', '2025-05-01', 'Free-funds Interest 2025-04', null, 2.5),
    K(46, 'Free-funds Interest Tax', '2025-05-01', 'Free-funds Interest Tax 2025-04', null, -0.7),
  ],
};
const RATES = { EUR: 1, USD: 1.17, GBP: 0.86 };
const sample = async (opts, data = SAMPLE) => parseXtb(await readXlsx(makeXlsx(xtbSheets(data), opts)), { rates: RATES });

/* ---------- testes ---------- */

test('xlsx: colunas, datas do Excel, texto partilhado e entidades', async () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('AB12'), 27);
  assert.equal(excelDate(45762.62), '2025-04-15');
  assert.equal(excelDate(46023), '2026-01-01');
  assert.equal(excelDate(''), '');
  const rows = parseSheet('<sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>P&amp;L &lt;x&gt;</t></is></c><c r="D2"><v>1.5</v></c></row></sheetData>');
  assert.deepEqual([rows[1][1], rows[1][3], rows[1].length], ['P&L <x>', 1.5, 4]);
  for (const shared of [false, true]) {
    const wb = await readXlsx(makeXlsx({ 'Folha 1': [['a', 1], [null, 'b & c']] }, { shared }));
    assert.deepEqual(Object.keys(wb), ['Folha 1']);
    assert.equal(wb['Folha 1'][1][1], 'b & c');
    assert.equal(wb['Folha 1'][0][1], 1);
  }
  await assert.rejects(readXlsx(new ArrayBuffer(10)), /xlsx/);
});

test('XTB: símbolos para o Yahoo e moeda de cotação', () => {
  assert.equal(xtbToYahoo('EDP.PT').y, 'EDP.LS');
  assert.equal(xtbToYahoo('AAPL.US').y, 'AAPL');
  assert.equal(xtbToYahoo('BRK.B.US').y, 'BRK-B');
  assert.equal(xtbToYahoo('VUSA.UK').y, 'VUSA.L');
  assert.equal(xtbToYahoo('VUAA.DE').y, 'VUAA.DE');
  assert.equal(xtbToYahoo('GOLD'), null);
  assert.equal(xtbToYahoo('US500'), null);
  assert.equal(guessQuoteCur('UK', 0.85, RATES), 'GBP');
  assert.equal(guessQuoteCur('UK', 86, RATES), 'GBp');
  assert.equal(guessQuoteCur('UK', 1.13, RATES), 'USD');
  assert.equal(guessQuoteCur('DE', 1.0, RATES), 'EUR');
  assert.equal(guessQuoteCur('US', NaN, RATES), 'USD');
});

test('XTB: lê posições abertas, vendas, dividendos e ignora CFDs', async () => {
  const s = await sample();
  assert.equal(s.currency, 'EUR');
  assert.deepEqual(s.period, { from: '2025-01-01', to: '2026-01-01' });
  assert.equal(s.snapshot, '2026-01-01');
  assert.deepEqual(s.open.map(r => [r.y, r.units, r.cost, r.date, r.quoteCur]), [
    ['VUAA.DE', 2, 190.1, '2025-04-15', 'EUR'], ['VUAA.DE', 0.5, 60, '2025-07-21', 'EUR'], ['AAPL', 2, 342.86, '2025-06-02', 'USD'],
  ]);
  assert.equal(s.open[2].lastPrice, 250);
  assert.deepEqual(s.closed.map(r => [r.y, r.units, r.cost, r.proceeds, r.date, r.closeDate]), [
    ['EDP.LS', 1000, 3500, 3700, '2025-03-03', '2025-05-05'], ['EDP.LS', 500, 1800, 1850, '2025-03-10', '2025-05-05'],
    ['NVDA', 1, 109.35, 110.6, '2025-01-27', '2025-02-10'],
  ]);
  assert.deepEqual(s.cfd, { count: 2, pl: -30 });
  assert.equal(s.dividends.length, 1);
  assert.deepEqual([s.dividends[0].y, s.dividends[0].gross, s.dividends[0].withheld, s.dividends[0].date], ['AAPL', 0.45, 0.07, '2025-08-14']);
  assert.deepEqual(s.interest, { gross: 2.5, tax: 0.7 });
  assert.ok(isXtb(await readXlsx(makeXlsx(xtbSheets()))));
  assert.ok(!isXtb({ Folha1: [] }));
  assert.ok(!JSON.stringify(s).includes('Fulano'), 'não guarda o nome do titular');
});

test('importar: cria posições, agrupa vendas e liga dividendos; reimportar não duplica', async () => {
  reset();
  memoryStorage();
  const s = await sample();
  const plan = planImport(s);
  assert.equal(plan.summary.openLots, 3);
  assert.deepEqual(plan.summary.newPositions.sort(), ['Apple', 'Vanguard S&P 500 UCITS (Acc)'].sort());
  assert.equal(plan.summary.sales, 2);
  assert.equal(plan.summary.saleLots, 3);
  assert.equal(plan.summary.dividends, 1);
  assert.equal(state.positions.length, 0, 'o plano não mexe no estado');
  applyImport(plan);
  const vuaa = state.positions.find(p => p.quoteSymbol === 'VUAA.DE');
  assert.equal(vuaa.platform, 'XTB');
  assert.equal(vuaa.lots.length, 2);
  assert.equal(vuaa.openedAt, '2025-04-15');
  const edp = state.closed.find(c => c.quoteSymbol === 'EDP.LS');
  assert.equal(edp.lots.length, 2);
  assert.equal(edp.proceeds, 5550);
  assert.equal(edp.closedAt, '2025-05-05');
  near(edp.exitPrice, 3.7);
  const apple = state.positions.find(p => p.quoteSymbol === 'AAPL');
  assert.equal(state.dividends[0].posId, apple.id);

  const again = planImport(await sample());
  assert.equal(again.summary.changes, 0);
  assert.equal(again.summary.skipped, 3 + 3 + 1);
});

test('importar: o ano seguinte fecha compras importadas antes', async () => {
  reset();
  applyImport(planImport(await sample()));
  const next = await sample({}, {
    open: [O(12, 'VUAA.DE', 0.5, 120, '2025-07-21', 60, 120)],
    closed: [C(11, 'VUAA.DE', 2, 95, '2025-04-15', 190.1, '2026-03-02', 115, 230)],
    cash: [],
  });
  const plan = planImport(next);
  assert.equal(plan.summary.reduced, 1);
  assert.equal(plan.summary.sales, 1);
  applyImport(plan);
  const vuaa = state.positions.find(p => p.quoteSymbol === 'VUAA.DE');
  assert.deepEqual(vuaa.lots.map(l => l.shares), [0.5]);
  const sale = state.closed.find(c => c.quoteSymbol === 'VUAA.DE');
  assert.equal(sale.parentId, vuaa.id);
  assert.equal(state.positions.find(p => p.quoteSymbol === 'AAPL').lots.length, 1, 'as outras ficam');
});

test('importar: substitui ou junta o que foi registado à mão na mesma corretora', async () => {
  const seed = () => {
    reset();
    state.positions = [
      { id: 'm1', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Vanguard', quoteSymbol: 'VUAA.DE', quoteCur: 'EUR', lots: [{ shares: 1.5, cost: 140, date: '2025-05-01' }] },
      { id: 'm2', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'EDP manual', quoteSymbol: 'EDP.LS', quoteCur: 'EUR', lots: [{ shares: 10, cost: 35, date: '2025-02-01' }] },
      { id: 'm3', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Depois', quoteSymbol: 'SPYL.DE', quoteCur: 'EUR', lots: [{ shares: 1, cost: 14, date: '2026-02-01' }] },
      { id: 'r1', kind: 'stock', platform: 'Revolut', currency: 'EUR', name: 'Outra', quoteSymbol: 'VUAA.DE', quoteCur: 'EUR', lots: [{ shares: 1, cost: 100, date: '2025-01-01' }] },
    ];
    state.closed = [{ id: 'c1', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'EDP', quoteSymbol: 'EDP.LS', lots: [{ shares: 1, cost: 3, date: '2025-03-01' }], proceeds: 4, closedAt: '2025-05-05' }];
    state.alerts = [{ id: 'a', posId: 'm1', price: 150, dir: 'above' }];
  };
  seed();
  const s = await sample();
  assert.deepEqual(manualCount('XTB', s), { lots: 2, sales: 1 });
  applyImport(planImport(s, { replace: true }));
  const vuaa = state.positions.find(p => p.id === 'm1');
  assert.equal(vuaa.lots.length, 2, 'lotes manuais trocados pelos do extrato');
  assert.ok(vuaa.lots.every(l => l.src));
  assert.equal(state.alerts.length, 1, 'mantém os alertas da posição');
  assert.ok(!state.positions.some(p => p.id === 'm2'), 'posição manual vendida sai');
  assert.ok(state.positions.some(p => p.id === 'm3'), 'compras depois da data do extrato ficam');
  assert.equal(state.positions.find(p => p.id === 'r1').lots.length, 1, 'outras corretoras não mudam');
  assert.ok(!state.closed.some(c => c.id === 'c1'));
  assert.equal(state.closed.filter(c => c.quoteSymbol === 'EDP.LS').length, 1);

  seed();
  applyImport(planImport(await sample(), { replace: false }));
  assert.equal(state.positions.find(p => p.id === 'm1').lots.length, 3);
  assert.ok(state.closed.some(c => c.id === 'c1'));
});

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
