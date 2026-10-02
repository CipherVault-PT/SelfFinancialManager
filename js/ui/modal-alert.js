import { state, commit } from '../store.js';
import { priceInfo } from '../calc.js';
import { alertsFor, addAlert, removeAlert } from '../alerts.js';
import { esc, price, sym, num } from '../format.js';
import { $, $$, toast, openModal, segmented, modalEl } from './dom.js';

export function modalAlert(id) {
  const p = state.positions.find(x => x.id === id);
  if (!p) return;
  const pi = priceInfo(p), cur = pi.cur;
  const list = alertsFor(id);
  openModal(`<div class="mh"><h3>Alertas · ${esc(p.name)}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <p class="mlead">Preço atual: <b>${pi.price > 0 ? price(pi.price, cur) : '—'}</b>${pi.live ? '' : ' <span style="color:var(--muted-2)">(sem cotação ao vivo — o alerta só dispara com cotação real)</span>'}. Aviso-te quando o preço passar o alvo.</p>
    <div class="mseg" id="alDir" style="margin-bottom:12px"><button type="button" data-d="above" class="on">▲ Sobe até</button><button type="button" data-d="below">▼ Desce até</button></div>
    <div class="row2"><div class="field"><label for="alPrice">Preço-alvo (${esc(sym(cur))})</label><input class="inp mono" id="alPrice" inputmode="decimal" autocomplete="off" placeholder="0,00" data-autofocus></div>
      <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn pri wide" id="alAdd" style="padding:11px">Criar alerta</button></div></div>
    ${list.length ? `<div class="sep"></div><div class="mlabel">Alertas definidos</div>${list.map(a => `
      <div class="set-row"><div class="sl">${a.above ? '▲' : '▼'} ${price(a.price, a.cur)} ${a.active ? '<span class="al-on">● ativo</span>' : '<span class="al-off">disparado</span>'}</div>
      <button type="button" class="x danger" data-dela="${esc(a.id)}" aria-label="Apagar alerta">✕</button></div>`).join('')}` : ''}`);

  let above = true;
  segmented($('#alDir'), 'd', d => { above = d === 'above'; });
  $('#alAdd').onclick = async () => {
    const v = num($('#alPrice').value);
    if (!(v > 0)) return toast('Mete o preço-alvo', true);
    try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* sem notificações */ }
    addAlert(p, { above, price: v, cur });
    commit();
    modalAlert(id);
    toast('Alerta criado');
  };
  for (const b of $$('[data-dela]', modalEl())) {
    b.onclick = () => { removeAlert(b.dataset.dela); commit(); modalAlert(id); };
  }
}

export function notifyAlerts(fired) {
  for (const a of fired) {
    const msg = `🔔 ${a.name}: ${a.above ? 'subiu para' : 'desceu para'} ${price(a.now, a.cur)} (alvo ${price(a.price, a.cur)})`;
    toast(msg);
    showNotification(msg);
  }
}

/** No Android as notificações têm de passar pelo service worker. */
async function showNotification(body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification('Aurora Investments', opts);
    new Notification('Aurora Investments', opts);
  } catch { /* notificações indisponíveis */ }
}
