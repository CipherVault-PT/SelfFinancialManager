export const STORAGE_KEY = 'zenite_v1';
export const SCHEMA_VERSION = 2;

export const PLATFORMS = ['Revolut', 'XTB', 'Trade Republic'];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'DKK'];
export const DEFAULT_RATES = { EUR: 1, USD: 1.17, GBP: 0.86, CHF: 0.93, DKK: 7.46 };

/** Corretoras que não cobram taxa de conversão cambial. */
export const NO_FX_FEE = ['Trade Republic', 'Revolut'];

export const SYM = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', DKK: 'kr' };

export const PLATFORM_CLASS = { 'Revolut': 'rev', 'XTB': 'xtb', 'Trade Republic': 'tr' };

export const ACCENTS = [
  { id: 'gold', n: 'Dourado', a: '#C9A96A', a2: '#DFC48C', rgb: '201,169,106' },
  { id: 'jade', n: 'Jade', a: '#54C295', a2: '#7FD6AF', rgb: '84,194,149' },
  { id: 'violet', n: 'Violeta', a: '#9B7EE0', a2: '#B9A3EC', rgb: '155,126,224' },
  { id: 'blue', n: 'Azul', a: '#5B9BD5', a2: '#86B7E3', rgb: '91,155,213' },
  { id: 'coral', n: 'Coral', a: '#E88B6B', a2: '#F0A98E', rgb: '232,139,107' },
  { id: 'emerald', n: 'Esmeralda', a: '#2EC98A', a2: '#5FD9A8', rgb: '46,201,138' },
  { id: 'rose', n: 'Rosa', a: '#E0729B', a2: '#EC9BB9', rgb: '224,114,155' },
];

export const BACKGROUNDS = [
  { id: 'aurora', n: 'Aurora', i: '🌌' },
  { id: 'net', n: 'Rede', i: '🕸️' },
  { id: 'stars', n: 'Estrelas', i: '✨' },
  { id: 'nebula', n: 'Nebulosa', i: '🌫️' },
  { id: 'none', n: 'Nenhum', i: '⬛' },
];

export const REFRESH = {
  cryptoMs: 60_000,
  fxMs: 30 * 60_000,
  fxFreshMs: 2 * 24 * 3600_000,
  stockMissBackoffMs: 15 * 60_000,
  liveQuoteMs: 20 * 60_000,
};
