import { state, uid } from './store.js';
import { conv } from './fx.js';
import { cashBal } from './calc.js';

/**
 * Movimentos de dinheiro entre posições e fundos/cash: para onde vai o dinheiro de uma venda
 * e de onde vem o de uma compra. Escolhas: 'broker' (saldo por investir na corretora),
 * 'cash:<id>' (um fundo existente) ou 'out' / 'new' (sai da app / dinheiro novo).
 */
export const BROKER = 'broker';
export const OUT = 'out';

export const brokerLabel = platform => `Saldo ${platform || 'por investir'}`;

/** Conta "saldo por investir" da corretora (criada só quando é precisa). */
export function brokerAccount(platform, currency, create = false) {
  let c = state.cash.find(x => x.broker && x.platform === platform && x.currency === currency);
  if (!c && create) {
    c = { id: uid(), label: brokerLabel(platform), currency, platform, broker: true, entries: [] };
    state.cash.push(c);
  }
  return c ?? null;
}

const accountOf = (choice, platform, currency, create) => {
  if (choice === BROKER) return brokerAccount(platform, currency, create);
  if (typeof choice === 'string' && choice.startsWith('cash:')) return state.cash.find(c => c.id === choice.slice(5)) ?? null;
  return null;
};

/** Opções de destino de uma venda, com a escolha sugerida. */
export function saleDestinations(platform, currency) {
  const broker = brokerAccount(platform, currency);
  const opts = [{ v: BROKER, label: `Fica na ${platform} (saldo por investir)`, bal: broker ? cashBal(broker) : 0, cur: currency }];
  for (const c of state.cash) {
    if (c === broker) continue;
    opts.push({ v: `cash:${c.id}`, label: `${c.label}${c.platform ? ` · ${c.platform}` : ''}`, bal: cashBal(c), cur: c.currency });
  }
  opts.push({ v: OUT, label: 'Sai da app (levantei ou gastei)' });
  const remembered = state.settings.cashDest?.[platform];
  const samePlatform = state.cash.find(c => !c.broker && c.platform === platform);
  const pick = opts.some(o => o.v === remembered) ? remembered : samePlatform ? `cash:${samePlatform.id}` : BROKER;
  return { opts, pick };
}

/** Opções de origem de uma compra: os fundos com saldo e "dinheiro novo". */
export function buySources(platform, currency) {
  const opts = [{ v: 'new', label: 'Dinheiro novo (depositado agora)' }];
  for (const c of state.cash) {
    const bal = cashBal(c);
    if (bal > 0.005) opts.push({ v: `cash:${c.id}`, label: c.broker ? `Saldo por investir · ${c.platform}` : `${c.label}${c.platform ? ` · ${c.platform}` : ''}`, bal, cur: c.currency });
  }
  const broker = brokerAccount(platform, currency);
  return { opts, pick: broker && cashBal(broker) > 0.005 ? `cash:${broker.id}` : 'new' };
}

/** Credita o valor de uma venda no destino escolhido. Devolve a conta (ou null se saiu da app). */
export function creditSale(choice, { amount, currency, platform, date, saleId }) {
  if (state.settings.cashDest?.[platform] !== choice) state.settings.cashDest = { ...state.settings.cashDest, [platform]: choice };
  const c = accountOf(choice, platform, currency, true);
  if (!c || !(amount > 0)) return null;
  c.entries.push({ amount: conv(amount, currency, c.currency), kind: 'sale', date, ref: `sale:${saleId}` });
  return c;
}

/**
 * Paga uma compra com o saldo escolhido (até ao que houver). Devolve quanto saiu do saldo,
 * na moeda da compra; o resto é dinheiro novo.
 */
export function debitBuy(choice, { amount, currency, platform, date, posId }) {
  const c = accountOf(choice, platform, currency, false);
  if (!c || !(amount > 0)) return 0;
  const avail = conv(Math.max(0, cashBal(c)), c.currency, currency);
  const used = Math.min(amount, avail);
  if (!(used > 0.005)) return 0;
  c.entries.push({ amount: -conv(used, currency, c.currency), kind: 'buy', date, ref: `pos:${posId}` });
  return used;
}

/**
 * Desfaz os movimentos ligados a uma venda ('sale:<id>') ou a uma posição ('pos:<id>').
 * Se o dinheiro de uma venda anulada já tinha sido usado em compras, essas compras passam
 * a contar (no que faltar) como dinheiro novo, para o saldo nunca ficar negativo.
 */
export function dropCashRefs(ref) {
  let n = 0;
  for (const c of state.cash) {
    const before = c.entries.length;
    c.entries = c.entries.filter(e => e.ref !== ref);
    if (before === c.entries.length) continue;
    n += before - c.entries.length;
    let short = -cashBal(c);
    for (let i = c.entries.length - 1; i >= 0 && short > 1e-9; i--) {
      const e = c.entries[i];
      if (e.kind !== 'buy') continue;
      const give = Math.min(short, -e.amount);
      e.amount += give;
      short -= give;
    }
    c.entries = c.entries.filter(e => !(e.kind === 'buy' && Math.abs(e.amount) < 1e-9));
  }
  state.cash = state.cash.filter(c => !(c.broker && !c.entries.length));
  return n;
}

/** Nome do sítio para onde foi o dinheiro de uma venda (para o histórico). */
export function saleCashLabel(saleId) {
  const c = state.cash.find(x => x.entries.some(e => e.ref === `sale:${saleId}`));
  return c ? c.label : null;
}
