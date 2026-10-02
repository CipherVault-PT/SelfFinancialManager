import { state } from '../store.js';
import { conv } from '../fx.js';
import { fetchJSON, pool, HttpError } from '../net.js';

const CG = 'https://api.coingecko.com/api/v3';
const BINANCE = 'https://api.binance.com/api/v3/ticker/24hr';
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE']);
const MIN_INTERVAL = 45_000;

let lastRun = 0;

const cryptoPositions = () => state.positions.filter(p => p.kind === 'crypto' && p.coingeckoId);

export function parseCoinGecko(d, ts = Date.now()) {
  const out = {};
  for (const [id, q] of Object.entries(d ?? {})) {
    if (!q || typeof q !== 'object') continue;
    const e = { ts };
    for (const k of ['eur', 'usd', 'eur_24h_change', 'usd_24h_change']) if (Number.isFinite(q[k])) e[k] = q[k];
    if (e.eur > 0 || e.usd > 0) out[id] = e;
  }
  return out;
}

export function parseBinance(d, ts = Date.now()) {
  const last = parseFloat(d?.lastPrice), chg = parseFloat(d?.priceChangePercent);
  if (!(last > 0)) return null;
  const e = { ts, usd: last, src: 'binance' };
  if (Number.isFinite(chg)) { e.usd_24h_change = chg; e.eur_24h_change = chg; }
  const eur = conv(last, 'USD', 'EUR');
  if (eur > 0) e.eur = eur;
  return e;
}

async function fromBinance(positions) {
  const got = {};
  await pool(positions, 4, async p => {
    const s = String(p.symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(s)) return;
    if (STABLE.has(s)) { got[p.coingeckoId] = { ts: Date.now(), usd: 1, eur: conv(1, 'USD', 'EUR'), usd_24h_change: 0, eur_24h_change: 0, src: 'binance' }; return; }
    const e = parseBinance(await fetchJSON(`${BINANCE}?symbol=${s}USDT`, { timeout: 8000 }));
    if (e) got[p.coingeckoId] = e;
  });
  return got;
}

/**
 * Atualiza as cotações de cripto: CoinGecko primeiro; a Binance cobre as moedas
 * que faltarem (ex: limite de pedidos da CoinGecko).
 * Devolve true se obteve pelo menos uma cotação.
 */
export async function fetchCryptoPrices({ force = false } = {}) {
  const positions = cryptoPositions();
  if (!positions.length) return true;
  if (!force && Date.now() - lastRun < MIN_INTERVAL) return true;
  lastRun = Date.now();

  const ids = [...new Set(positions.map(p => p.coingeckoId))];
  let got = {};
  try {
    const url = `${CG}/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=eur,usd&include_24hr_change=true`;
    got = parseCoinGecko(await fetchJSON(url, { timeout: 10_000 }));
  } catch { /* segue para a reserva */ }

  const missing = positions.filter(p => !got[p.coingeckoId]);
  if (missing.length) {
    try { Object.assign(got, await fromBinance(missing)); } catch { /* sem reserva */ }
  }
  if (!Object.keys(got).length) return false;
  Object.assign(state.cache.prices, got);
  state.cache.updated = Date.now();
  return true;
}

/** Pesquisa moedas na CoinGecko. Lança erro com mensagem legível se falhar. */
export async function searchCoins(q) {
  try {
    const d = await fetchJSON(`${CG}/search?query=${encodeURIComponent(q)}`, { timeout: 8000 });
    return (d.coins ?? []).slice(0, 8).map(c => ({
      id: String(c.id), name: String(c.name), symbol: String(c.symbol), thumb: String(c.thumb || ''), rank: c.market_cap_rank,
    }));
  } catch (e) {
    throw new Error(e instanceof HttpError && e.status === 429 ? 'Muitos pedidos — tenta daqui a 1 minuto' : 'Erro de ligação');
  }
}
