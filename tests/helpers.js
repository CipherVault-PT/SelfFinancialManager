import { state, hydrate, defaultCache, defaultSettings } from '../js/store.js';

/** Repõe o estado com câmbio "fresco" e taxas fixas para testes determinísticos. */
export function reset(overrides = {}) {
  hydrate({ version: 2, positions: [], closed: [], cash: [], alerts: [], history: [] });
  state.settings = { ...defaultSettings(), ...overrides.settings };
  state.cache = { ...defaultCache(), rates: { EUR: 1, USD: 1.25, GBP: 0.8, CHF: 1, DKK: 7.5 }, fxUpdated: Date.now() };
  return state;
}

export const lot = (shares, cost, extra = {}) => ({ shares, cost, priceQ: null, priceCur: null, date: '2025-01-02', ...extra });

export function stockPos(extra = {}) {
  return {
    id: 'p1', kind: 'stock', platform: 'XTB', currency: 'EUR', name: 'Apple', symbol: 'AAPL',
    quoteSymbol: 'AAPL', quoteCur: 'USD', lots: [lot(10, 800)], ...extra,
  };
}

export function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    for (const [match, body] of routes) {
      if (String(url).includes(match)) {
        const value = typeof body === 'function' ? body(String(url)) : body;
        if (value instanceof Error) throw value;
        const status = value?.__status ?? 200;
        return new Response(JSON.stringify(value), { status });
      }
    }
    throw new TypeError('network');
  };
  return calls;
}
