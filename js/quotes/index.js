import { commit } from '../store.js';
import { fetchFx } from '../fx.js';
import { recordHistory } from '../history.js';
import { checkAlerts } from '../alerts.js';
import { fetchCryptoPrices } from './crypto.js';
import { fetchStockQuotes } from './stocks.js';

/** Estado das últimas atualizações (não é guardado). */
export const net = { busy: 0, manual: false, fx: null, crypto: null, stocks: null };

let alertHandler = () => {};
export const onAlerts = fn => { alertHandler = fn; };

/** Atualiza câmbio + cotações, regista o histórico, verifica alertas e redesenha. */
export async function refresh({ crypto = true, stocks = true, force = false } = {}) {
  net.busy++;
  if (force) net.manual = true;
  try {
    net.fx = await fetchFx({ force });
    const [c, s] = await Promise.all([
      crypto ? fetchCryptoPrices({ force }) : null,
      stocks ? fetchStockQuotes({ force }) : null,
    ]);
    if (c !== null) net.crypto = c;
    if (s !== null) net.stocks = s;
    recordHistory();
    const fired = checkAlerts();
    if (fired.length) alertHandler(fired);
  } finally {
    net.busy--;
    if (!net.busy) net.manual = false;
    commit();
  }
}
