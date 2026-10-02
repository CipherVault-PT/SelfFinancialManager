import { lockConfig, setPin, checkPin, disableLock, setAfter, validPin, bioAvailable, enrollBio, removeBio, waitMs, AFTER_OPTS } from '../lock.js';
import { $, toast, openModal, segmented } from './dom.js';

/** Secção "Bloqueio" das Definições. */
export function lockSection() {
  const c = lockConfig();
  return `<div class="sep"></div>
    <div class="set-sec" id="lkSec">🔒 Bloqueio</div>
    <div class="set-row"><div><div class="sl">PIN</div><div class="sd">${c ? `<span style="color:var(--up)">● Ligado</span> · ${c.len} algarismos` : 'Desligado — qualquer pessoa com o telemóvel desbloqueado vê a carteira'}</div></div>
      <div class="sh-r">${c
        ? '<button type="button" class="btn ghost sm" id="lkChange">Mudar</button><button type="button" class="btn ghost sm" id="lkOff">Desligar</button>'
        : '<button type="button" class="btn pri sm" id="lkOn">Ativar</button>'}</div></div>
    ${c ? `<div class="set-row" id="lkBioRow" hidden><div><div class="sl">Impressão digital / Face ID</div><div class="sd">${c.cred ? '<span style="color:var(--up)">● Ligado</span>' : 'Desbloquear sem escrever o PIN'}</div></div>
      <button type="button" class="btn ${c.cred ? 'ghost' : 'pri'} sm" id="lkBio">${c.cred ? 'Desligar' : 'Ativar'}</button></div>
    <div class="field"><label>Bloquear ao sair da app</label>
      <div class="mseg cur5" id="lkAfter">${AFTER_OPTS.map(([m, l]) => `<button type="button" data-m="${m}" class="${(c.after ?? 1) === m ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
    <div class="sd" style="font-size:12px;color:var(--muted-2);line-height:1.45;margin-top:8px">Protege contra quem pegue no dispositivo. Não cifra os dados: quem tiver acesso ao browser no computador ou a um backup consegue lê-los. O PIN fica só neste dispositivo e não vai nos backups.</div>`;
}

export function bindLockSection(back) {
  $('#lkOn')?.addEventListener('click', () => modalPin('create', back));
  $('#lkChange')?.addEventListener('click', () => modalPin('change', back));
  $('#lkOff')?.addEventListener('click', () => modalPin('disable', back));
  segmented($('#lkAfter'), 'm', m => { setAfter(+m); toast(+m ? `Bloqueia ${m} min depois de saíres` : 'Bloqueia logo que saíres'); });
  const row = $('#lkBioRow');
  if (row) bioAvailable().then(ok => { row.hidden = !ok; });
  $('#lkBio')?.addEventListener('click', async () => {
    if (lockConfig()?.cred) { removeBio(); toast('Impressão digital / Face ID desligado'); return back(); }
    try {
      await enrollBio();
      toast('Impressão digital / Face ID ativado');
    } catch {
      toast('Não foi possível ativar — confirma que o dispositivo tem impressão digital ou Face ID configurado', true);
    }
    back();
  });
}

const TITLES = { create: 'Criar PIN', change: 'Mudar PIN', disable: 'Desligar o bloqueio' };
const pinInput = (id, label, auto = false) => `<div class="field"><label for="${id}">${label}</label>
  <input class="inp mono pin-inp" id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"${auto ? ' data-autofocus' : ''}></div>`;

function modalPin(mode, back) {
  const needOld = mode !== 'create', needNew = mode !== 'disable';
  openModal(`<div class="mh"><h3>${TITLES[mode]}</h3><button type="button" class="x" id="pBack" aria-label="Voltar">✕</button></div>
    ${needNew ? '<p class="mlead">4 a 8 algarismos. Se o esqueceres, só consegues entrar apagando os dados deste dispositivo — guarda um backup.</p>' : ''}
    <form id="pForm" autocomplete="off">
      ${needOld ? pinInput('pOld', 'PIN atual', true) : ''}
      ${needNew ? `${pinInput('pNew', 'Novo PIN', !needOld)}${pinInput('pRep', 'Repetir o PIN')}` : ''}
      <button type="submit" class="btn pri wide" style="margin-top:6px">${mode === 'disable' ? 'Desligar' : 'Guardar'}</button>
    </form>`);
  for (const i of document.querySelectorAll('.pin-inp')) i.oninput = () => { i.value = i.value.replace(/\D/g, '').slice(0, 8); };
  $('#pBack').onclick = back;
  $('#pForm').onsubmit = async e => {
    e.preventDefault();
    if (needOld) {
      if (waitMs() > 0) return toast(`Demasiadas tentativas — espera ${Math.ceil(waitMs() / 1000)} s`, true);
      if (!(await checkPin($('#pOld').value))) return toast('PIN atual errado', true);
    }
    if (mode === 'disable') {
      disableLock();
      toast('Bloqueio desligado');
      return back();
    }
    const pin = $('#pNew').value;
    if (!validPin(pin)) return toast('O PIN tem de ter 4 a 8 algarismos', true);
    if (pin !== $('#pRep').value) return toast('Os dois PIN não são iguais', true);
    await setPin(pin);
    toast(mode === 'create' ? 'PIN ativado — a app pede-o ao abrir' : 'PIN mudado');
    back();
  };
}
