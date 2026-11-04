import { isCurrency } from '../format.js';
import { marketOf, latestSession, dateIn, MARKETS } from '../markets.js';
import { viaProxies, SUBUNITS } from './stocks.js';

/** Períodos do gráfico de uma ação: do minuto (1D) ao mês (Máx). `ttl`: quanto tempo os dados ficam em memória. */
export const RANGES = [
  { id: '1d', label: '1D', interval: '1m', ttl: 60_000 },
  { id: '5d', label: '1S', interval: '15m', ttl: 5 * 60_000 },
  { id: '1mo', label: '1M', interval: '60m', ttl: 15 * 60_000 },
  { id: '6mo', label: '6M', interval: '1d', ttl: 3600_000 },
  { id: '1y', label: '1A', interval: '1d', ttl: 3600_000 },
  { id: '5y', label: '5A', interval: '1wk', ttl: 6 * 3600_000 },
  { id: 'max', label: 'Máx', interval: '1mo', ttl: 6 * 3600_000 },
];

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const rangeOf = id => RANGES.find(r => r.id === id) ?? RANGES[0];

/**
 * Endereço do gráfico no Yahoo. No 1D pede a última sessão que começou (nos EUA, do pré ao pós-mercado),
 * porque o "dia" do Yahoo antes da abertura ainda pode ser o de ontem.
 */
export function chartUrl(y, range, now = Date.now()) {
  const r = rangeOf(range), id = marketOf(y);
  const q = new URLSearchParams({ interval: r.interval });
  const s = r.id === '1d' && id ? latestSession(id, now) : null;
  if (s) {
    q.set('period1', String(Math.floor((s.pre ?? s.open) / 1000)));
    q.set('period2', String(Math.ceil(Math.min(now, s.post ?? s.close) / 60_000) * 60));
  } else q.set('range', r.id);
  if (r.id === '1d' && id === 'us') q.set('includePrePost', 'true');
  return `${BASE}${encodeURIComponent(y)}?${q}`;
}

/** { pts: [[ms, preço]…], cur, prev } — preços em subunidades (ex.: pence) já convertidos. */
export function parseChart(d) {
  const r = d?.chart?.result?.[0], m = r?.meta;
  const ts = r?.timestamp, close = r?.indicators?.quote?.[0]?.close;
  if (!m || !Array.isArray(ts) || !Array.isArray(close)) return null;
  const [cur, div] = SUBUNITS[m.currency] ?? [m.currency, 1];
  if (!isCurrency(cur)) return null;
  const pts = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (Number.isFinite(t) && c > 0) pts.push([t * 1000, c / div]);
  });
  const prev = m.chartPreviousClose ?? m.previousClose;
  return { pts, cur, prev: prev > 0 ? prev / div : null };
}

/** Só o último dia de uma série de vários dias, com o fecho do dia anterior como referência. */
export function lastDay(data, y) {
  const tz = MARKETS[marketOf(y)]?.tz ?? 'UTC', day = t => dateIn(t, tz);
  const last = day(data.pts.at(-1)[0]);
  const i = data.pts.findIndex(p => day(p[0]) === last);
  return { ...data, pts: data.pts.slice(i), prev: i > 0 ? data.pts[i - 1][1] : data.prev };
}

const accept = d => d && typeof d === 'object' && 'chart' in d;
const cache = new Map();

/** Dados do gráfico (null se o Yahoo não responder). Se o 1D vier vazio (feriado, sessão a começar), usa o último dia com negócios. */
export async function fetchChart(y, range, now = Date.now()) {
  const key = `${y}|${range}`, hit = cache.get(key);
  if (hit && now - hit.at < rangeOf(range).ttl) return hit.data;
  let data = await viaProxies(chartUrl(y, range, now), accept, parseChart);
  if (range === '1d' && !(data?.pts.length >= 2)) {
    const wide = await viaProxies(`${BASE}${encodeURIComponent(y)}?range=5d&interval=5m`, accept, parseChart);
    if (wide?.pts.length >= 2) data = lastDay(wide, y);
  }
  if (!(data?.pts.length >= 2)) return null;
  cache.set(key, { at: now, data });
  return data;
}
