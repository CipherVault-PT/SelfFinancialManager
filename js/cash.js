import { PLATFORMS } from './config.js';
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

/** Nome de uma conta nas listas de escolha. */
export const accountLabel = c => (c.broker ? `Saldo por investir · ${c.platform}` : `${c.label}${c.platform ? ` · ${c.platform}` : ''}`);

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
    if (bal > 0.005) opts.push({ v: `cash:${c.id}`, label: accountLabel(c), bal, cur: c.currency });
  }
  const broker = brokerAccount(platform, currency);
  return { opts, pick: broker && cashBal(broker) > 0.005 ? `cash:${broker.id}` : 'new' };
}

/**
 * Credita dinheiro recebido (venda ou dividendo) no destino escolhido e lembra a escolha da corretora.
 * Devolve a conta (ou null se o dinheiro saiu da app).
 */
export function creditCash(choice, { amount, currency, platform, date, ref, kind = 'sale', accountCurrency = currency }) {
  if (state.settings.cashDest?.[platform] !== choice) state.settings.cashDest = { ...state.settings.cashDest, [platform]: choice };
  const c = accountOf(choice, platform, accountCurrency, true);
  if (!c || !(amount > 0)) return null;
  c.entries.push({ amount: conv(amount, currency, c.currency), kind, date, ref });
  return c;
}

export const creditSale = (choice, { saleId, ...o }) => creditCash(choice, { ...o, ref: `sale:${saleId}` });

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

/* ---------- transferências entre contas ---------- */

/** Para onde se pode transferir: as outras contas e o saldo por investir das corretoras que ainda não o têm. */
export function transferTargets(fromId) {
  const from = state.cash.find(c => c.id === fromId);
  const opts = state.cash.filter(c => c.id !== fromId).map(c => ({ v: `cash:${c.id}`, label: accountLabel(c), bal: cashBal(c), cur: c.currency }));
  for (const p of PLATFORMS) {
    if (!state.cash.some(c => c.broker && c.platform === p)) opts.push({ v: `broker:${p}`, label: `Saldo por investir · ${p} (novo)`, bal: 0, cur: from?.currency ?? 'EUR' });
  }
  return opts;
}

/**
 * Passa dinheiro de uma conta para outra (ex: saldo da Revolut → fundo de emergência ou → XTB para investir).
 * `received` é o valor que chega, quando as moedas são diferentes (por omissão, ao câmbio do dia).
 */
export function transferCash({ from, to, amount, received = null, date }) {
  const src = state.cash.find(c => c.id === from);
  if (!src) throw new Error('Escolhe a conta de origem');
  if (!(amount > 0)) throw new Error('Indica o valor');
  if (amount > cashBal(src) + 0.005) throw new Error(`O saldo só tem ${Math.max(0, cashBal(src)).toFixed(2).replace('.', ',')}`);
  const dst = to?.startsWith('broker:') ? brokerAccount(to.slice(7), src.currency, true)
    : state.cash.find(c => `cash:${c.id}` === to);
  if (!dst || dst === src) throw new Error('Escolhe a conta de destino');
  const got = received > 0 ? received : conv(amount, src.currency, dst.currency);
  const ref = `tr:${uid()}`;
  src.entries.push({ amount: -amount, kind: 'transfer', date, ref });
  dst.entries.push({ amount: got, kind: 'transfer', date, ref });
  return { src, dst, got, ref };
}

/** A outra conta de uma transferência (para mostrar "→ Fundo de emergência" / "← Saldo Revolut"). */
export function transferPeer(ref, selfId) {
  return state.cash.find(c => c.id !== selfId && c.entries.some(e => e.ref === ref)) ?? null;
}
