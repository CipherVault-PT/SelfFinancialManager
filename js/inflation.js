import { state } from './store.js';
import { fetchJSON } from './net.js';
import { viaProxies } from './quotes/stocks.js';

/**
 * Inflação em Portugal: índice harmonizado de preços no consumidor (IHPC) mensal, do BCE.
 * Serve para descontar a inflação à rentabilidade (ganho em poder de compra).
 */
const SERIES = 'ICP/M.PT.N.000000.4.INX';
const MAX_AGE = 7 * 86_400_000;
const RETRY = 30 * 60_000;

const url = from => `https://data-api.ecb.europa.eu/service/data/${SERIES}?format=jsondata&startPeriod=${from}`;
const monthOf = iso => String(iso).slice(0, 7);

/** SDMX-JSON do BCE → [[AAAA-MM, índice], …]. */
export function parseEcbSeries(d) {
  const series = d?.dataSets?.[0]?.series;
  const obs = series && Object.values(series)[0]?.observations;
  const times = d?.structure?.dimensions?.observation?.[0]?.values;
  if (!obs || !Array.isArray(times)) return null;
  const out = [];
  for (const [i, v] of Object.entries(obs)) {
    const t = times[+i]?.id, x = Array.isArray(v) ? +v[0] : NaN;
    if (/^\d{4}-\d{2}$/.test(t ?? '') && x > 0) out.push([t, x]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out.length ? out : null;
}

const validSeries = s => Array.isArray(s) && s.length > 1 && s.every(x => Array.isArray(x) && /^\d{4}-\d{2}$/.test(x[0]) && x[1] > 0);

export function hicpSeries() {
  const c = state.cache.hicp;
  return validSeries(c?.points) ? c.points : null;
}

/**
 * Inflação entre o mês de `fromIso` e o último mês publicado:
 * { period (fração), annual (fração/ano), months, from, to }.
 */
export function inflationSince(points, fromIso) {
  if (!points?.length) return null;
  const m = monthOf(fromIso);
  const base = points.find(p => p[0] >= m) ?? null, last = points.at(-1);
  if (!base || base === last) return null;
  const [by, bm] = base[0].split('-').map(Number), [ly, lm] = last[0].split('-').map(Number);
  const months = (ly - by) * 12 + (lm - bm);
  if (months < 1) return null;
  const period = last[1] / base[1] - 1;
  return { period, annual: (1 + period) ** (12 / months) - 1, months, from: base[0], to: last[0] };
}

/** Rentabilidade descontada da inflação, na mesma base (anual ou do período) que `rate`. */
export function realRate(rate, days, infl) {
  if (rate == null || !infl) return null;
  return (1 + rate) / (1 + (days >= 365 ? infl.annual : infl.period)) - 1;
}

let running = null, lastFail = 0;

/** Vai buscar (no máximo uma vez por semana) o índice desde o mês da primeira compra. */
export function ensureInflation(start) {
  if (!start) return Promise.resolve(false);
  const from = monthOf(start), c = state.cache.hicp;
  if (hicpSeries() && c.from <= from && Date.now() - c.ts < MAX_AGE) return Promise.resolve(false);
  if (Date.now() - lastFail < RETRY) return Promise.resolve(false);
  const accept = d => d && typeof d === 'object' && 'dataSets' in d;
  running ??= fetchJSON(url(from), { timeout: 9000 })
    .then(d => (accept(d) ? parseEcbSeries(d) : null))
    .catch(() => null)
    .then(points => points ?? viaProxies(url(from), accept, parseEcbSeries))
    .then(points => {
      if (!points) { lastFail = Date.now(); return false; }
      state.cache.hicp = { from, ts: Date.now(), points };
      return true;
    })
    .catch(() => { lastFail = Date.now(); return false; })
    .finally(() => { running = null; });
  return running;
}

/** Só para testes. */
export const _resetInflation = () => { running = null; lastFail = 0; };
