import { state } from '../store.js';
import { marketStatus, extPhaseAt } from '../markets.js';

/**
 * Segunda fonte do pré/pós-mercado dos EUA: as cotações do site da CNBC (sem chave nem documentação oficial).
 * O Yahoo só apanha negócios de algumas bolsas fora de horas; nas ações com menos volume a CNBC pode ter
 * o preço mais recente. Experimental: se não responder, fica o Yahoo.
 */
const MAX_PER_CALL = 10;
const BACKOFF = 15 * 60_000;
const toCnbc = y => y.replace(/-/g, '.');

export const cnbcUrl = syms =>
  `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${syms.map(y => encodeURIComponent(toCnbc(y))).join('%7C')}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;

export const isCnbc = d => !!d && typeof d === 'object' && ('FormattedQuoteResult' in d || 'QuickQuoteResult' in d);

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

function timeOf(e) {
  const ms = num(e?.last_time_msec);
  if (ms > 1e12) return ms;
  const t = Date.parse(String(e?.last_time ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? t : null;
}

/** { SÍMBOLO_YAHOO: { price, phase, at, src: 'cnbc' } } a partir da resposta da CNBC. */
export function parseCnbc(d, syms = []) {
  const back = new Map(syms.map(y => [toCnbc(y).toUpperCase(), y]));
  const r = d?.FormattedQuoteResult?.FormattedQuote ?? d?.QuickQuoteResult?.QuickQuote ?? [];
  const out = {};
  for (const q of Array.isArray(r) ? r : [r]) {
    const e = q?.ExtendedMktQuote ?? q?.extendedMktQuote;
    const sym = String(q?.symbol ?? '').toUpperCase();
    const price = num(e?.last), at = timeOf(e);
    const phase = at ? extPhaseAt(at) : null;
    if (!sym || !(price > 0) || !phase) continue;
    out[back.get(sym) ?? sym] = { price, phase, at, src: 'cnbc' };
  }
  return out;
}

/**
 * Pede à CNBC o pré/pós-mercado das ações dos EUA indicadas (só fora do horário normal).
 * Com atalho próprio só passa por ele (os intermediários públicos são lentos); se não responder, pausa 15 min.
 */
export async function cnbcExtended(syms, viaProxies, now = Date.now()) {
  const phase = marketStatus('us', now).phase;
  if (!syms.length || (phase !== 'pre' && phase !== 'post') || now - (state.cache.cnbcFail || 0) < BACKOFF) return {};
  const publicFallback = !(state.settings.proxyUrl || '').trim();
  const out = {};
  let answered = false;
  for (let i = 0; i < syms.length; i += MAX_PER_CALL) {
    const part = syms.slice(i, i + MAX_PER_CALL);
    const got = await viaProxies(cnbcUrl(part), isCnbc, d => parseCnbc(d, part), { publicFallback }).catch(() => null);
    if (got) { answered = true; Object.assign(out, got); }
  }
  if (!answered) state.cache.cnbcFail = now;
  return out;
}

/**
 * Junta o pré/pós-mercado da CNBC ao do Yahoo: fica o negócio mais recente.
 * Ignora preços absurdos (mais de 50% longe do fecho) e o que for de outro dia que não o atual.
 */
export function mergeExtended(quotes, cnbc) {
  let used = 0;
  for (const [y, c] of Object.entries(cnbc)) {
    const q = quotes[y];
    if (!(q?.price > 0) || Math.abs(c.price / q.price - 1) > 0.5) continue;
    if (q.ext && q.ext.at >= c.at) continue;
    q.ext = { ...c, pct: ((c.price - q.price) / q.price) * 100 };
    used++;
  }
  return used;
}
