import { state } from './store.js';
import { agg, closedM } from './calc.js';
import { conv } from './fx.js';
import { todayISO } from './format.js';
import { netOf } from './dividends.js';
import { fetchYahooSeries } from './quotes/stocks.js';

const DAY = 86_400_000;
/** ETF de acumulação do S&P 500 em euros (dividendos reinvestidos): comparação justa para quem investe em €. */
export const BENCHMARK = { y: 'SXR8.DE', name: 'S&P 500' };
const BENCH_MAX_AGE = 12 * 3600_000;
const BENCH_RETRY = 30 * 60_000;
/** Abaixo disto, a rentabilidade não é calculada (poucos dias dão números sem significado). */
export const MIN_DAYS = 30;

const years = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY / 365;
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * Taxa interna de rentabilidade anual (XIRR) de fluxos datados [{d, v}]:
 * negativos = dinheiro investido, positivos = dinheiro recebido ou valor final.
 */
export function xirr(flows) {
  if (flows.length < 2 || !flows.some(f => f.v < 0) || !flows.some(f => f.v > 0)) return null;
  const t0 = flows[0].d;
  const npv = r => flows.reduce((s, f) => s + f.v / (1 + r) ** years(t0, f.d), 0);
  let lo = -0.9999, hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-10) return mid;
    if (fm * flo < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/**
 * Rentabilidade para mostrar: anual a partir de 1 ano; antes disso, a do período
 * (anualizar poucos meses dá números enganadores).
 */
export function shownRate(annual, days) {
  if (annual == null || days < MIN_DAYS) return null;
  return days >= 365 ? annual : (1 + annual) ** (days / 365) - 1;
}

/**
 * Fluxos de caixa dos investimentos em EUR (sem fundos/cash): cada compra é dinheiro investido;
 * vendas e dividendos líquidos são dinheiro recebido.
 */
export function cashFlows() {
  const flows = [];
  let missingDates = 0;
  const fallback = todayISO(new Date(state.settings.createdAt || Date.now()));
  for (const p of [...state.positions, ...state.closed]) {
    for (const l of p.lots ?? []) {
      let d = l.date || p.openedAt;
      if (!d) { d = fallback; missingDates++; }
      flows.push({ d, v: -conv(l.cost, p.currency, 'EUR') });
    }
  }
  for (const c of state.closed) {
    if (c.closedAt) flows.push({ d: c.closedAt, v: conv(closedM(c, c.currency).proceeds, c.currency, 'EUR') });
  }
  for (const x of state.dividends) flows.push({ d: x.date, v: conv(netOf(x), x.currency, 'EUR') });
  flows.sort((a, b) => a.d.localeCompare(b.d) || b.v - a.v);
  return { flows: flows.filter(f => Number.isFinite(f.v) && f.v !== 0), missingDates };
}

export const firstBuyDate = () => cashFlows().flows.find(f => f.v < 0)?.d ?? null;

/**
 * Capital máximo que esteve investido ao mesmo tempo (compras menos o que já tinha voltado).
 * Com muitas compras e vendas, a soma das compras conta o mesmo dinheiro várias vezes.
 */
export function peakCapital(flows) {
  let net = 0, peak = 0;
  for (const f of flows) { net -= f.v; peak = Math.max(peak, net); }
  return peak;
}

/** Rentabilidade da carteira (em EUR): ganho total e TIR anual desde a primeira compra. */
export function performance(today = todayISO()) {
  const { flows, missingDates } = cashFlows();
  const buys = flows.filter(f => f.v < 0);
  if (!buys.length) return null;
  const invested = -buys.reduce((s, f) => s + f.v, 0);
  const received = flows.filter(f => f.v > 0).reduce((s, f) => s + f.v, 0);
  const value = agg('EUR').val;
  const gain = value + received - invested;
  const start = buys[0].d, days = Math.max(0, daysBetween(start, today));
  const withEnd = value > 0 ? [...flows, { d: today, v: value }] : flows;
  const annual = days >= MIN_DAYS ? xirr(withEnd) : null;
  const capital = peakCapital(flows);
  return {
    start, days, invested, received, value, gain, missingDates, annual, flows, capital,
    totalPct: capital > 0 ? (gain / capital) * 100 : 0,
    rate: shownRate(annual, days),
  };
}

/** Último preço da série até à data (ou o primeiro disponível, se a data for anterior à série). */
export function priceOn(series, d) {
  let lo = 0, hi = series.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= d) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return series[best >= 0 ? best : 0]?.[1] ?? null;
}

/**
 * "E se tivesse investido no S&P 500?": o mesmo dinheiro, nas mesmas datas.
 * Cada compra compra unidades do ETF; cada venda/dividendo retira o mesmo valor.
 */
export function benchmarkCompare(flows, series, today = todayISO()) {
  if (!series?.length || !flows.length) return null;
  let units = 0;
  for (const f of flows) {
    const p = priceOn(series, f.d);
    if (!(p > 0)) return null;
    units += -f.v / p;
  }
  const value = Math.max(0, units * series.at(-1)[1]);
  const days = Math.max(0, daysBetween(flows.find(f => f.v < 0)?.d ?? today, today));
  const annual = days >= MIN_DAYS && value > 0 ? xirr([...flows, { d: today, v: value }]) : null;
  return { value, annual, rate: shownRate(annual, days) };
}

const validSeries = s => Array.isArray(s) && s.length > 0
  && s.every(x => Array.isArray(x) && typeof x[0] === 'string' && x[1] > 0);

/** Série guardada do ETF de referência, se for válida. */
export function benchSeries() {
  const c = state.cache.bench;
  return c?.y === BENCHMARK.y && validSeries(c.points) ? c.points : null;
}

let running = null, lastFail = 0;

/** Vai buscar (no máximo duas vezes por dia) a série do ETF de referência desde a primeira compra. */
export function ensureBenchmark(start = firstBuyDate()) {
  if (!start) return Promise.resolve(false);
  const from = new Date(Date.parse(start) - 10 * DAY).toISOString().slice(0, 10);
  const c = state.cache.bench;
  if (benchSeries() && c.from <= from && Date.now() - c.ts < BENCH_MAX_AGE) return Promise.resolve(false);
  if (Date.now() - lastFail < BENCH_RETRY) return Promise.resolve(false);
  running ??= fetchYahooSeries(BENCHMARK.y, from)
    .then(points => {
      if (!points) { lastFail = Date.now(); return false; }
      state.cache.bench = { y: BENCHMARK.y, from, ts: Date.now(), points };
      return true;
    })
    .catch(() => { lastFail = Date.now(); return false; })
    .finally(() => { running = null; });
  return running;
}

/** 'ok' | 'loading' | 'fail' | 'idle' — para a interface mostrar o estado da comparação. */
export const benchState = () => (benchSeries() ? 'ok' : running ? 'loading' : lastFail ? 'fail' : 'idle');

/** Só para testes. */
export const _resetBenchmark = () => { running = null; lastFail = 0; };
