import { state } from '../store.js';
import { conv } from '../fx.js';
import { cashBal } from '../calc.js';
import { saleDestinations, buySources, brokerAccount, BROKER } from '../cash.js';
import { esc, money } from '../format.js';

/**
 * Campo "para onde vai / de onde vem o dinheiro" das vendas e compras.
 * `amount()` dá o valor da operação na moeda `currency()` para mostrar o efeito no saldo.
 */
export function cashPicker(el, { mode, platform, currency, amount }) {
  let choice = null;

  const accountFor = v => (v === BROKER ? brokerAccount(platform(), currency())
    : v?.startsWith('cash:') ? state.cash.find(c => c.id === v.slice(5)) : null);

  function render() {
    const { opts, pick } = mode === 'sale' ? saleDestinations(platform(), currency()) : buySources(platform(), currency());
    if (!opts.some(o => o.v === choice)) choice = pick;
    if (mode === 'buy' && opts.length < 2) { el.innerHTML = ''; choice = 'new'; return; }
    el.innerHTML = `<div class="field"><label for="${mode}Cash">${mode === 'sale' ? 'Para onde vai o dinheiro' : 'De onde vem o dinheiro'}</label>
      <select class="inp" id="${mode}Cash">${opts.map(o => `<option value="${esc(o.v)}"${o.v === choice ? ' selected' : ''}>${esc(o.label)}${o.bal > 0.005 ? ` — ${esc(money(o.bal, o.cur))}` : ''}</option>`).join('')}</select>
      <div class="curhint" id="${mode}CashHint"></div></div>`;
    el.querySelector('select').onchange = e => { choice = e.target.value; update(); };
    update();
  }

  function update() {
    const hint = el.querySelector('.curhint');
    if (!hint) return;
    const amt = amount(), c = accountFor(choice);
    if (choice === 'out' || choice === 'new' || !(amt > 0)) {
      hint.textContent = choice === 'out' ? 'Não fica registado em nenhum fundo.' : choice === 'new' ? 'Não mexe nos teus fundos/saldos.' : '';
      return;
    }
    const cur = c?.currency ?? currency(), bal = c ? cashBal(c) : 0, delta = conv(amt, currency(), cur);
    if (mode === 'sale') {
      hint.innerHTML = `${c ? esc(c.label) : 'Saldo por investir'}: ${money(bal, cur)} → <b>${money(bal + delta, cur)}</b>`;
    } else {
      const used = Math.min(delta, Math.max(0, bal));
      hint.innerHTML = used >= delta - 0.005
        ? `Sai do saldo: ${money(bal, cur)} → <b>${money(bal - used, cur)}</b>`
        : `O saldo só tem ${money(bal, cur)}: usa tudo e o resto (<b>${money(delta - used, cur)}</b>) conta como dinheiro novo.`;
    }
  }

  render();
  return { value: () => choice, render, update };
}
