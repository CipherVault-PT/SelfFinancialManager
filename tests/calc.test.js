import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { lotCalc, metrics, priceInfo, closedM, agg, feeFor } from '../js/calc.js';
import { recordHistory } from '../js/history.js';
import { checkAlerts, addAlert } from '../js/alerts.js';
import { reset, lot, stockPos } from './helpers.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('compra na XTB em USD aplica a taxa de 0,5% (bug: a pré-visualização ignorava a plataforma)', () => {
  reset();
  const base = { mode: 'stock', moneyCur: 'EUR', priceCur: 'USD', shares: 10, priceQ: 100 };
  close(lotCalc({ ...base, fee: feeFor('XTB') }).cost, 800 * 1.005);
  close(lotCalc({ ...base, fee: feeFor('Revolut') }).cost, 800);
  assert.equal(lotCalc({ ...base, fee: feeFor('XTB') }).feeApplied, true);
  assert.equal(lotCalc({ ...base, fee: feeFor('XTB'), cost: 812 }).cost, 812);
  close(lotCalc({ ...base, fee: feeFor('XTB'), rate: 0.81 }).cost, 810);
});

test('lotCalc rejeita valores inválidos', () => {
  reset();
  assert.equal(lotCalc({ mode: 'stock', moneyCur: 'EUR', shares: 0, priceQ: 10 }).ok, false);
  assert.equal(lotCalc({ mode: 'amount', moneyCur: 'EUR', price: NaN, amount: 10 }).ok, false);
  const c = lotCalc({ mode: 'amount', moneyCur: 'EUR', price: 50_000, amount: 1000 });
  close(c.units, 0.02);
});

test('mudar a moeda de visualização não cria perdas falsas', () => {
  reset();
  state.positions = [stockPos({ quoteSymbol: 'GALP.LS', quoteCur: 'EUR', lots: [lot(10, 100)] })];
  state.cache.stockPrices['GALP.LS'] = { price: 10, cur: 'EUR', dayPct: 0, ts: Date.now() };
  assert.equal(agg('EUR').unreal, 0);
  close(agg('USD').unreal, 0);
});

test('ação em USD numa conta em EUR desconta a taxa de saída da XTB', () => {
  reset();
  state.positions = [stockPos()];
  state.cache.stockPrices.AAPL = { price: 100, cur: 'USD', dayPct: 10, ts: Date.now() };
  const m = metrics(state.positions[0], 'EUR');
  close(m.valPos, 800 * 0.995);
  close(m.plPos, 800 * 0.995 - 800);
  close(m.dayD, m.valD - m.valD / 1.1);
});

test('sem câmbio recente, a ação estrangeira usa o preço manual', () => {
  reset();
  state.positions = [stockPos({ manualPrice: 85 })];
  state.cache.stockPrices.AAPL = { price: 100, cur: 'USD', ts: Date.now() };
  state.cache.fxUpdated = Date.now() - 3 * 24 * 3600_000;
  const pi = priceInfo(state.positions[0]);
  assert.equal(pi.live, false);
  assert.equal(pi.price, 85);
  assert.equal(pi.cur, 'EUR');
});

test('cripto usa a cotação na moeda da conta ou converte a partir de USD', () => {
  reset();
  const p = { id: 'c1', kind: 'crypto', platform: 'Revolut', currency: 'EUR', coingeckoId: 'bitcoin', lots: [lot(0.1, 4000)] };
  state.cache.prices.bitcoin = { usd: 62_500, usd_24h_change: 2, ts: Date.now() };
  const pi = priceInfo(p);
  assert.equal(pi.live, true);
  close(pi.price, 50_000);
  assert.equal(pi.dayPct, 2);
});

test('posição fechada usa o valor recebido', () => {
  reset();
  const p = { ...stockPos(), proceeds: 900, exitPrice: 120, exitCur: 'USD' };
  const m = closedM(p, 'EUR');
  assert.equal(m.pl, 100);
  close(m.plp, 12.5);
});

test('o histórico guarda sempre em EUR, seja qual for a moeda mostrada', () => {
  reset({ settings: { displayCurrency: 'USD' } });
  state.cash = [{ id: 'k', label: 'F', currency: 'EUR', entries: [{ amount: 200, kind: 'deposit', date: '' }] }];
  recordHistory();
  state.settings.displayCurrency = 'EUR';
  recordHistory();
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].v, 200);
});

test('alertas convertem para a moeda do alerta e ignoram preços manuais', () => {
  reset();
  const p = stockPos({ quoteCur: 'USD', manualPrice: 150 });
  state.positions = [p];
  addAlert(p, { above: false, price: 220, cur: 'USD' });
  addAlert(p, { above: true, price: 190, cur: 'EUR' });

  state.cache.stockPrices.AAPL = { price: 230, cur: 'USD', ts: Date.now() };
  assert.deepEqual(checkAlerts().map(a => a.cur), []);

  state.cache.fxUpdated = 0; // câmbio velho → preço manual 150 € não pode disparar o alerta de 220 $
  assert.deepEqual(checkAlerts(), []);

  state.cache.fxUpdated = Date.now();
  state.cache.stockPrices.AAPL = { price: 250, cur: 'USD', ts: Date.now() }; // = 200 €
  const fired = checkAlerts();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].cur, 'EUR');
  close(fired[0].now, 200);
});
