import { PLATFORMS, CURRENCIES } from '../config.js';
import { state, commit, uid } from '../store.js';
import { cashBal, cashBreak, cashEntries } from '../calc.js';
import { conv } from '../fx.js';
import { accountLabel, brokerLabel, transferTargets, transferCash, transferPeer, dropCashRefs } from '../cash.js';
import { esc, money, sym, num, inputNum, todayISO } from '../format.js';
import { $, $$, toast, openModal, segmented, modalEl } from './dom.js';

const opts = list => list.map(x => `<option>${esc(x)}</option>`).join('');

const ENTRY = { interest: '💰 Juros', sale: '↩ Venda', buy: '↗ Compra' };

function entryLabel(e, c) {
  if (e.kind === 'transfer') {
    const peer = transferPeer(e.ref, c.id);
    return `⇄ ${e.amount < 0 ? 'Para' : 'De'} ${esc(peer ? peer.label : 'outra conta')}`;
  }
  return ENTRY[e.kind] ?? (e.amount < 0 ? 'Levantamento' : 'Depósito');
}

function breakdown(b, cur) {
  return [
    (b.deposit || (!b.sale && !b.buy && !b.transfer)) && `Depositado ${money(b.deposit, cur)}`,
    b.interest > 0 && `<span style="color:var(--up)">Juros ${money(b.interest, cur)}</span>`,
    b.sale > 0 && `De vendas ${money(b.sale, cur)}`,
    b.buy < 0 && `Usado em compras ${money(-b.buy, cur)}`,
    Math.abs(b.transfer) > 0.005 && `Transferências ${b.transfer > 0 ? '+' : ''}${money(b.transfer, cur)}`,
  ].filter(Boolean).join(' · ');
}

export function modalCash() {
  const open = new Set();
  const draw = () => {
    openModal(`<div class="mh"><h3>Fundo / Cash</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
      <p class="mlead">Dinheiro parado ou fundo de emergência (ex: liquidez na Trade Republic) e o saldo por investir de cada corretora. Quando vendes, escolhes para onde vai o dinheiro; quando compras, podes pagar com estes saldos. Tudo entra no património total.</p>
      ${state.cash.some(c => cashBal(c) > 0.005) ? '<button type="button" class="btn ghost wide" data-tr="" style="margin-bottom:14px">⇄ Transferir entre contas</button>' : ''}
      ${state.cash.length ? `<div class="cashlist">${state.cash.map(c => {
        const b = cashBreak(c), ents = cashEntries(c), id = esc(c.id);
        return `<div class="cashcard">
          <div class="cashtop"><div style="min-width:0"><div class="sl">${esc(c.label)} ${c.platform ? `<span class="chip">${esc(c.platform)}</span>` : ''}${c.broker ? ' <span class="chip">por investir</span>' : ''}</div>
            <div class="sd" style="margin-top:3px">${breakdown(b, c.currency)}</div></div>
            <div class="cashbal mono">${money(cashBal(c), c.currency)}</div></div>
          ${ents.length > 1 ? `<div class="cashents"${open.has(c.id) ? '' : ' hidden'}>${ents.map((e, i) => `<div class="lot"><span>${entryLabel(e, c)}${e.date ? ` · ${esc(e.date)}` : ''}</span><span class="lc">${money(e.amount, c.currency)} <button type="button" class="x mini" data-dele="${id}:${i}" aria-label="Apagar movimento">✕</button></span></div>`).join('')}</div>` : ''}
          <div class="cashbtns">
            <button type="button" class="btn ghost cbtn" data-add="${id}">＋ Movimento</button>
            ${cashBal(c) > 0.005 ? `<button type="button" class="btn ghost cbtn" data-tr="${id}" aria-label="Transferir">⇄</button>` : ''}
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
    for (const b of $$('[data-tr]', modalEl())) b.onclick = () => modalTransfer(b.dataset.tr);
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
        const c = state.cash.find(x => x.id === cid), e = c?.entries[+i];
        if (!e) return;
        if (e.kind === 'transfer' && e.ref) {
          if (!confirm('Apagar esta transferência? O dinheiro volta à conta de origem.')) return;
          dropCashRefs(e.ref);
        } else {
          if (!confirm('Apagar este movimento?')) return;
          c.entries.splice(+i, 1);
        }
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

/* ---------- transferir entre contas ---------- */

function modalTransfer(fromId) {
  const sources = state.cash.filter(c => cashBal(c) > 0.005).sort((a, b) => !!b.broker - !!a.broker);
  if (!sources.length) return toast('Não há saldo para transferir', true);
  let from = sources.find(c => c.id === fromId) ?? sources[0];
  openModal(`<div class="mh"><h3>Transferir dinheiro</h3><button type="button" class="x" data-action="cash" aria-label="Voltar">✕</button></div>
    <p class="mlead">Passa dinheiro de uma conta para outra — por exemplo, do saldo da Revolut para o fundo de emergência, ou para a XTB para investir.</p>
    <div class="field"><label for="tFrom">De</label><select class="inp" id="tFrom">${sources.map(c =>
      `<option value="${esc(c.id)}"${c === from ? ' selected' : ''}>${esc(accountLabel(c))} — ${esc(money(cashBal(c), c.currency))}</option>`).join('')}</select></div>
    <div class="field"><label for="tTo">Para</label><select class="inp" id="tTo"></select></div>
    <div class="field"><label for="tAmt">Valor <span id="tCur"></span><button type="button" class="lnk" id="tAll" style="float:right">tudo</button></label>
      <input class="inp mono" id="tAmt" inputmode="decimal" autocomplete="off" placeholder="0,00" data-autofocus></div>
    <div id="tFx"></div>
    <div class="field"><label for="tDate">Data</label><input class="inp" id="tDate" type="date" max="${todayISO()}" value="${todayISO()}"></div>
    <div class="preview" id="tPrev" hidden></div>
    <button type="button" class="btn pri wide" id="tDo">Transferir</button>`);

  const targetAccount = () => state.cash.find(c => `cash:${c.id}` === $('#tTo').value) ?? null;
  const dstCur = () => targetAccount()?.currency ?? from.currency;
  const received = () => {
    const amt = num($('#tAmt').value);
    const r = num($('#tRecv')?.value ?? '');
    return r > 0 ? r : amt > 0 ? conv(amt, from.currency, dstCur()) : NaN;
  };

  function renderTo() {
    const prev = $('#tTo').value;
    const list = transferTargets(from.id);
    const pick = list.some(o => o.v === prev) ? prev : (list.find(o => !o.v.startsWith('broker:')) ?? list[0])?.v;
    $('#tTo').innerHTML = list.map(o => `<option value="${esc(o.v)}"${o.v === pick ? ' selected' : ''}>${esc(o.label)}${o.bal > 0.005 ? ` — ${esc(money(o.bal, o.cur))}` : ''}</option>`).join('');
    $('#tCur').textContent = `(${sym(from.currency)})`;
    renderFx();
  }

  function renderFx() {
    const cross = dstCur() !== from.currency;
    $('#tFx').innerHTML = cross
      ? `<div class="field"><label for="tRecv">Chega (${esc(sym(dstCur()))}) <span class="sublbl">ao câmbio de hoje</span></label>
          <input class="inp mono" id="tRecv" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>`
      : '';
    update();
  }

  function update() {
    const amt = num($('#tAmt').value), got = received(), pv = $('#tPrev');
    const ok = amt > 0 && got > 0;
    pv.hidden = !ok;
    const r = $('#tRecv');
    if (r && !r.value && amt > 0) r.placeholder = inputNum(conv(amt, from.currency, dstCur()));
    if (!ok) return;
    const dst = targetAccount(), fb = cashBal(from), db = dst ? cashBal(dst) : 0;
    const dstName = dst ? dst.label : brokerLabel($('#tTo').value.replace('broker:', ''));
    pv.innerHTML = `<div class="pr"><span>${esc(from.label)}</span><b>${money(fb, from.currency)} → ${money(fb - amt, from.currency)}</b></div>
      <div class="pr"><span>${esc(dstName)}</span><b>${money(db, dstCur())} → ${money(db + got, dstCur())}</b></div>
      ${amt > fb + 0.005 ? `<div class="pr"><span style="color:var(--down)">O saldo só tem ${money(fb, from.currency)}</span></div>` : ''}`;
  }

  $('#tFrom').onchange = e => { from = sources.find(c => c.id === e.target.value) ?? from; renderTo(); };
  $('#tTo').onchange = renderFx;
  $('#tAll').onclick = () => { $('#tAmt').value = inputNum(cashBal(from)); update(); };
  $('#tAmt').oninput = update;
  $('#tFx').oninput = update;
  renderTo();

  $('#tDo').onclick = () => {
    try {
      const amount = num($('#tAmt').value);
      const r = num($('#tRecv')?.value ?? '');
      const { dst, got } = transferCash({ from: from.id, to: $('#tTo').value, amount, received: r > 0 ? r : null, date: $('#tDate').value || todayISO() });
      commit();
      modalCash();
      toast(`${money(got, dst.currency)} transferidos para ${dst.label}`);
    } catch (err) {
      toast(err.message, true);
    }
  };
}
