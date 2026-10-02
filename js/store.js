import { STORAGE_KEY, SCHEMA_VERSION, DEFAULT_RATES } from './config.js';
import { resolveStock } from './stocks.js';

export const defaultSettings = () => ({
  displayCurrency: 'EUR', fxManual: null, apiKey: '', refreshMin: 5, fxFeePct: 0.5,
  proxyUrl: '', bgStyle: 'aurora', accent: 'gold',
  createdAt: null, lastBackup: null, backupSnoozeUntil: 0,
});

export const defaultCache = () => ({
  prices: {}, stockPrices: {}, stockMiss: {}, rates: { ...DEFAULT_RATES },
  updated: null, stockUpdated: null, fxUpdated: null, proxyPref: null,
});

export const state = {
  version: SCHEMA_VERSION,
  positions: [], closed: [], cash: [], dividends: [], alerts: [], history: [],
  settings: defaultSettings(),
  cache: defaultCache(),
};

const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* armazenamento indisponível */ }
}

/** Guarda e volta a desenhar tudo o que depende do estado. */
export function commit() {
  save();
  for (const fn of listeners) fn();
}

export function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* dados corrompidos */ }
  if (raw && typeof raw === 'object') hydrate(raw);
  state.settings.createdAt ||= firstUse();
}

export const hasData = (s = state) => s.positions.length + s.closed.length + s.cash.length + (s.dividends?.length || 0) > 0;

const arr = v => (Array.isArray(v) ? v : []);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const n = v => (Number.isFinite(+v) ? +v : 0);

/** Substitui o estado por dados guardados/importados, normalizando e migrando formatos antigos. */
export function hydrate(d, { keepCache = false } = {}) {
  const fromVersion = n(d.version) || 1;
  state.positions = arr(d.positions).map(normalizePosition);
  state.closed = arr(d.closed).map(normalizePosition);
  state.cash = arr(d.cash).map(normalizeCash);
  state.dividends = arr(d.dividends).map(normalizeDividend).filter(x => x.gross > 0 && x.date);
  state.alerts = arr(d.alerts).filter(a => a && a.posId && n(a.price) > 0);
  state.history = arr(d.history).filter(h => h && h.d && n(h.v) > 0).map(h => ({ d: String(h.d), v: n(h.v) }));
  state.settings = { ...defaultSettings(), ...obj(d.settings) };
  if (!keepCache) {
    const c = obj(d.cache);
    state.cache = { ...defaultCache(), ...c, rates: { ...DEFAULT_RATES, ...obj(c.rates), EUR: 1 } };
  }
  if (fromVersion < 2) migrateV1(fromVersion, keepCache);
  pruneAlerts();
  state.settings.createdAt ||= firstUse();
  state.version = SCHEMA_VERSION;
}

const firstUse = () => Date.parse(state.history[0]?.d) || Date.now();

function normalizeLot(l) {
  return {
    shares: n(l.shares), cost: n(l.cost),
    priceQ: n(l.priceQ) > 0 ? n(l.priceQ) : null,
    priceCur: l.priceCur || null,
    date: l.date || '',
    ...(typeof l.src === 'string' && l.src ? { src: l.src } : {}),
  };
}

function normalizePosition(p) {
  const out = { ...p };
  if (!Array.isArray(out.lots) || !out.lots.length) {
    const shares = n(p.entryPrice) > 0 ? n(p.invested) / n(p.entryPrice) : 0;
    out.lots = [{ shares, cost: n(p.invested), priceQ: null, priceCur: null, date: p.openedAt || '' }];
  }
  out.lots = out.lots.map(normalizeLot);
  delete out.invested; delete out.entryPrice;
  if (out.kind === 'stock' && out.quoteSymbol === undefined) {
    const s = resolveStock(out.symbol, out.exchange);
    out.quoteSymbol = s ? s.y : (out.symbol || null);
    out.quoteCur = s ? s.c : (out.quoteCur || out.currency);
  }
  return out;
}

function normalizeDividend(x) {
  return {
    id: String(x.id || uid()), posId: x.posId || null, name: String(x.name || ''), symbol: String(x.symbol || ''),
    platform: String(x.platform || ''), date: String(x.date || ''), currency: x.currency || 'EUR',
    gross: n(x.gross), withheld: Math.max(0, n(x.withheld)),
    ...(typeof x.src === 'string' && x.src ? { src: x.src } : {}),
  };
}

function normalizeCash(c) {
  const entries = Array.isArray(c.entries)
    ? c.entries
    : (n(c.amount) > 0 ? [{ amount: n(c.amount), kind: 'deposit', date: c.date || '' }] : []);
  const out = { ...c };
  delete out.amount; delete out.date;
  return { ...out, entries: entries.map(e => ({ amount: n(e.amount), kind: e.kind === 'interest' ? 'interest' : 'deposit', date: e.date || '' })) };
}

/**
 * v1 → v2: as cotações passam a ser indexadas pelo símbolo Yahoo (único) e o histórico
 * passa a ser guardado sempre em EUR (antes ficava na moeda que estava a ser mostrada).
 */
function migrateV1(fromVersion, keepCache) {
  if (!keepCache) state.cache.stockPrices = {};
  if (fromVersion === 1 && state.settings.displayCurrency !== 'EUR') {
    const rate = state.cache.rates[state.settings.displayCurrency] || 1;
    state.history = state.history.map(h => ({ d: h.d, v: h.v / rate }));
  }
}

/** Remove alertas de posições que já não estão abertas. */
export function pruneAlerts() {
  const open = new Set(state.positions.map(p => p.id));
  state.alerts = state.alerts.filter(a => open.has(a.posId));
}

export function exportJSON() {
  return JSON.stringify({ ...state, cache: undefined }, null, 2);
}

export function importJSON(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object' || !Array.isArray(d.positions)) throw new Error('Ficheiro inválido');
  snapshotForUndo('import');
  hydrate({ ...d, version: d.version ?? 1 }, { keepCache: true });
  state.cache.stockPrices = {};
  state.cache.stockMiss = {};
}

export function wipe() {
  snapshotForUndo('wipe');
  state.positions = []; state.closed = []; state.cash = []; state.dividends = []; state.alerts = []; state.history = [];
  state.cache.prices = {}; state.cache.stockPrices = {}; state.cache.stockMiss = {};
}

/* ---------- desfazer importação / apagamento ---------- */

const UNDO_KEY = `${STORAGE_KEY}_undo`;

/** Guarda uma cópia dos dados atuais antes de os substituir (só se houver dados). */
export function snapshotForUndo(reason) {
  if (!hasData()) return;
  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ ts: Date.now(), reason, data: JSON.parse(exportJSON()) })); } catch { /* sem espaço */ }
}

export function readUndo() {
  try {
    const u = JSON.parse(localStorage.getItem(UNDO_KEY));
    return u?.data && Array.isArray(u.data.positions) ? u : null;
  } catch { return null; }
}

export function restoreUndo() {
  const u = readUndo();
  if (!u) return false;
  hydrate(u.data, { keepCache: true });
  try { localStorage.removeItem(UNDO_KEY); } catch { /* ignorado */ }
  return true;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
