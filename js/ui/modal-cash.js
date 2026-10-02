import { PLATFORMS, CURRENCIES } from '../config.js';
import { state, commit, uid } from '../store.js';
import { cashBal, cashBreak, cashEntries } from '../calc.js';
import { esc, money, sym, num, todayISO } from '../format.js';
import { $, $$, toast, openModal, segmented, modalEl } from './dom.js';

const opts = list => list.map(x => `<option>${esc(x)}</option>`).join('');

export function modalCash() {
  const open = new Set();
  const draw = () => {
    openModal(`<div class="mh"><h3>Fundo / Cash</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
      <p class="mlead">Dinheiro parado ou fundo de emergência (ex: liquidez na Trade Republic). Vais somando o teu dinheiro e os juros recebidos — ambos entram no património total.</p>
      ${state.cash.length ? `<div class="cashlist">${state.cash.map(c => {
        const b = cashBreak(c), ents = cashEntries(c), id = esc(c.id);
        return `<div class="cashcard">
          <div class="cashtop"><div style="min-width:0"><div class="sl">${esc(c.label)} ${c.platform ? `<span class="chip">${esc(c.platform)}</span>` : ''}</div>
            <div class="sd" style="margin-top:3px">Depositado ${money(b.deposit, c.currency)}${b.interest > 0 ? ` · <span style="color:var(--up)">Juros ${money(b.interest, c.currency)}</span>` : ''}</div></div>
            <div class="cashbal mono">${money(cashBal(c), c.currency)}</div></div>
          ${ents.length > 1 ? `<div class="cashents"${open.has(c.id) ? '' : ' hidden'}>${ents.map((e, i) => `<div class="lot"><span>${e.kind === 'interest' ? '💰 Juros' : e.amount < 0 ? 'Levantamento' : 'Depósito'}${e.date ? ` · ${esc(e.date)}` : ''}</span><span class="lc">${money(e.amount, c.currency)} <button type="button" class="x mini" data-dele="${id}:${i}" aria-label="Apagar movimento">✕</button></span></div>`).join('')}</div>` : ''}
          <div class="cashbtns">
            <button type="button" class="btn ghost cbtn" data-add="${id}">＋ Movimento</button>
            ${ents.length > 1 ? `<button type="button" class="btn ghost cbtn" data-entst="${id}">${ents.length} movimentos ${open.has(c.id) ? '▴' : '▾'}</button>` : ''}
            <button type="button" class="x danger" data-delc="${id}" style="margin-left:auto" aria-label="Apagar fundo">✕</button></div>
        </div>`;
      }).join('')}</div>` : ''}
      <div class="sep"></div>
      <div class="mlabel">Novo fundo</div>
      <div class="field"><label for="kLabel">Etiqueta</label><input class="inp" id="kLabel" placeholder="Fundo de emergência" autocomplete="off"></div>
      <div class="row2">
        <div class="field"><label for="kAmt">Valor inicial</label><input class="inp mono" id="kAmt" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>
        <div class="field"><label for="kCur">Moeda</label><select class="inp" id="kCur">${opts(CURRENCIES)}</select></div></div>
      <div class="field"><label for="kPlat">Plataforma</label><select class="inp" id="kPlat">${opts([...PLATFORMS, 'Outra'])}</select></div>
      <button type="button" class="btn pri wide" id="kDo">Criar fundo</button>`);

    $('#kDo').onclick = () => {
      const label = $('#kLabel').value.trim(), am = num($('#kAmt').value);
      if (!label || !(am > 0)) return toast('Preenche etiqueta e valor', true);
      state.cash.push({ id: uid(), label, currency: $('#kCur').value, platform: $('#kPlat').value, entries: [{ amount: am, kind: 'deposit', date: todayISO() }] });
      commit(); draw(); toast('Fundo criado');
    };
    for (const b of $$('[data-add]', modalEl())) b.onclick = () => modalCashEntry(b.dataset.add);
    for (const b of $$('[data-entst]', modalEl())) {
      b.onclick = () => { open.has(b.dataset.entst) ? open.delete(b.dataset.entst) : open.add(b.dataset.entst); draw(); };
    }
    for (const b of $$('[data-delc]', modalEl())) {
      b.onclick = () => {
        if (!confirm('Apagar este fundo e todos os seus movimentos?')) return;
        state.cash = state.cash.filter(c => c.id !== b.dataset.delc);
        commit(); draw();
      };
    }
    for (const b of $$('[data-dele]', modalEl())) {
      b.onclick = () => {
        const [cid, i] = b.dataset.dele.split(':');
        const c = state.cash.find(x => x.id === cid);
        if (!c || !confirm('Apagar este movimento?')) return;
        c.entries.splice(+i, 1);
        commit(); draw();
      };
    }
  };
  draw();
}

function modalCashEntry(id) {
  const c = state.cash.find(x => x.id === id);
  if (!c) return;
  let kind = 'deposit';
  openModal(`<div class="mh"><h3>${esc(c.label)}</h3><button type="button" class="x" data-action="cash" aria-label="Voltar">✕</button></div>
    <p class="mlead">Saldo atual: <b>${money(cashBal(c), c.currency)}</b></p>
    <div class="mseg" id="cType" style="margin-bottom:14px">
      <button type="button" data-k="deposit" class="on">Depósito</button>
      <button type="button" data-k="interest">Juros</button>
      <button type="button" data-k="withdraw">Levantamento</button></div>
    <div class="row2">
      <div class="field"><label for="cAmt">Valor (${esc(sym(c.currency))})</label><input class="inp mono" id="cAmt" inputmode="decimal" autocomplete="off" placeholder="0,00" data-autofocus></div>
      <div class="field"><label for="cDate">Data</label><input class="inp" id="cDate" type="date" max="${todayISO()}" value="${todayISO()}"></div></div>
    <button type="button" class="btn pri wide" id="cDo">Guardar movimento</button>`);
  segmented($('#cType'), 'k', k => { kind = k; });
  $('#cDo').onclick = () => {
    const am = num($('#cAmt').value);
    if (!(am > 0)) return toast('Mete o valor', true);
    if (kind === 'withdraw' && am > cashBal(c) + 1e-9) return toast('O levantamento é maior que o saldo', true);
    c.entries.push({ amount: kind === 'withdraw' ? -am : am, kind: kind === 'interest' ? 'interest' : 'deposit', date: $('#cDate').value || todayISO() });
    commit();
    modalCash();
    toast(kind === 'interest' ? 'Juros somados ao fundo' : kind === 'withdraw' ? 'Levantamento registado' : 'Depósito somado ao fundo');
  };
}
