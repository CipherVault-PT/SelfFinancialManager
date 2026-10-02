import { DEFAULT_RATES, REFRESH } from './config.js';
import { state } from './store.js';
import { fetchJSON } from './net.js';

export const disp = () => state.settings.displayCurrency;

/** Taxas de câmbio com base EUR (1 EUR = R[x] x). */
export function rates() {
  const R = { ...DEFAULT_RATES, ...state.cache.rates, EUR: 1 };
  if (state.settings.fxManual > 0) R.USD = state.settings.fxManual;
  return R;
}

export const canConvert = cur => cur === 'EUR' || rates()[cur] > 0;

export function conv(amount, from, to = disp()) {
  if (from === to) return amount;
  const R = rates();
  if (!(R[from] > 0) || !(R[to] > 0)) return NaN;
  return amount / R[from] * R[to];
}

export const fxRate = () => rates().USD;

/** O câmbio real (não o de reserva) foi obtido recentemente ou foi definido à mão. */
export const fxFresh = () =>
  state.settings.fxManual > 0 || (state.cache.fxUpdated > 0 && Date.now() - state.cache.fxUpdated < REFRESH.fxFreshMs);

const FX_SOURCES = [
  { url: 'https://api.frankfurter.app/latest?from=EUR', pick: d => d.rates },
  { url: 'https://api.frankfurter.dev/v1/latest?base=EUR', pick: d => d.rates },
  { url: 'https://open.er-api.com/v6/latest/EUR', pick: d => d.rates },
];

export function parseRates(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (/^[A-Z]{3}$/.test(k) && Number.isFinite(v) && v > 0) out[k] = v;
  return out.USD ? { ...out, EUR: 1 } : null;
}

/** Vai buscar o câmbio do BCE (Frankfurter), com uma fonte alternativa. */
export async function fetchFx({ force = false } = {}) {
  if (!force && state.cache.fxUpdated && Date.now() - state.cache.fxUpdated < REFRESH.fxMs) return true;
  for (const src of FX_SOURCES) {
    try {
      const r = parseRates(src.pick(await fetchJSON(src.url, { timeout: 8000 })));
      if (r) {
        state.cache.rates = { ...DEFAULT_RATES, ...r };
        state.cache.fxUpdated = Date.now();
        return true;
      }
    } catch { /* tenta a fonte seguinte */ }
  }
  return false;
}
