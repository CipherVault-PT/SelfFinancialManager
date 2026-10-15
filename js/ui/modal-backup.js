import { saveBackup, sealedInfo, openBackup, MIN_BACKUP_PASS } from '../backup.js';
import { syncConfig } from '../sync/engine.js';
import { $, toast, openModal, closeModal, segmented } from './dom.js';

const keyring = () => {
  const c = syncConfig();
  return c?.key ? { key: c.key, salt: c.salt, iter: c.iter } : null;
};

const passField = (id, label, auto) => `<div class="field"><label for="${id}">${label}</label>
  <div class="pqrow"><input class="inp" id="${id}" type="password" autocomplete="${auto}" data-autofocus>
    <button type="button" class="btn ghost" id="${id}Eye" aria-label="Mostrar">👁</button></div></div>`;

const bindEye = (id, ...ids) => {
  $(`#${id}Eye`).onclick = () => { for (const i of ids.map(x => $(`#${x}`))) i.type = i.type === 'password' ? 'text' : 'password'; };
};

/** Guardar backup: cifrado (por omissão) ou em claro. */
export function modalBackup({ onSaved = () => {}, back = closeModal } = {}) {
  const kr = keyring();
  let mode = 'lock';
  openModal(`<div class="mh"><h3>Guardar backup</h3><button type="button" class="x" id="bkX" aria-label="Fechar">✕</button></div>
    <p class="mlead">O ficheiro tem todos os teus investimentos. <b>Cifrado</b>, só abre com a palavra-passe — mesmo que vá parar às mãos erradas.</p>
    <div class="mseg" id="bkMode" style="margin-bottom:12px"><button type="button" data-m="lock" class="on">🔒 Cifrado</button><button type="button" data-m="plain">Sem cifra</button></div>
    <div id="bkLock">${kr
      ? '<div class="curhint">Usa a <b>frase-passe da sincronização</b> — a mesma dos outros dispositivos. Não precisas de a escrever agora; só para repor.</div>'
      : `${passField('bkP1', 'Palavra-passe do backup', 'new-password')}
        <div class="field"><label for="bkP2">Repetir</label><input class="inp" id="bkP2" type="password" autocomplete="new-password"></div>
        <div class="curhint">Mínimo ${MIN_BACKUP_PASS} caracteres. <b>Se a esqueceres, o backup não abre</b> — guarda-a num gestor de passwords.</div>`}</div>
    <div id="bkPlain" class="curhint" hidden><b style="color:var(--down)">Quem tiver o ficheiro vê tudo.</b> Usa só se precisares de o abrir noutro programa.</div>
    <button type="button" class="btn pri wide" id="bkGo" style="margin-top:14px">Guardar</button>`);
  $('#bkX').onclick = back;
  if (!kr) bindEye('bkP1', 'bkP1', 'bkP2');
  segmented($('#bkMode'), 'm', m => {
    mode = m;
    $('#bkLock').hidden = m !== 'lock';
    $('#bkPlain').hidden = m === 'lock';
  });
  $('#bkGo').onclick = async () => {
    const opts = {};
    if (mode === 'lock' && kr) opts.keyring = kr;
    else if (mode === 'lock') {
      const p1 = $('#bkP1').value, p2 = $('#bkP2').value;
      if (p1.length < MIN_BACKUP_PASS) return toast(`A palavra-passe precisa de ${MIN_BACKUP_PASS}+ caracteres`, true);
      if (p1 !== p2) return toast('As palavras-passe não coincidem', true);
      opts.password = p1;
    }
    const go = $('#bkGo');
    go.disabled = true;
    go.textContent = mode === 'lock' ? 'A cifrar…' : 'A guardar…';
    try {
      if (!(await saveBackup(opts))) {
        go.disabled = false;
        go.textContent = 'Guardar';
        return;
      }
    } catch {
      go.disabled = false;
      go.textContent = 'Guardar';
      return toast('Não consegui guardar o backup', true);
    }
    onSaved(mode === 'lock');
  };
}

/**
 * Repor um backup: em claro aplica logo; cifrado tenta a chave da sincronização e, se não servir,
 * pede a palavra-passe. `apply(json)` substitui os dados (lança erro se o ficheiro for inválido).
 */
export async function restoreBackup(text, apply, back = closeModal) {
  const finish = json => {
    try {
      apply(json);
    } catch {
      toast('Ficheiro inválido', true);
    }
  };
  const info = sealedInfo(text);
  if (!info) return finish(text);
  try {
    const json = await openBackup(text, { keyring: keyring() });
    if (json != null) return finish(json);
  } catch (e) {
    if (e.message === 'Ficheiro inválido') return toast(e.message, true);
  }
  openModal(`<div class="mh"><h3>Backup cifrado</h3><button type="button" class="x" id="brX" aria-label="Fechar">✕</button></div>
    <p class="mlead">${info.sync
      ? 'Foi cifrado com a <b>frase-passe da sincronização</b> que usavas quando o guardaste.'
      : 'Escreve a palavra-passe que escolheste ao guardar este backup.'}</p>
    ${passField('brP', info.sync ? 'Frase-passe' : 'Palavra-passe', 'current-password')}
    <div class="curhint">Os dados atuais são substituídos — ficam em ⚙ → <b>Repor os dados de antes</b>.</div>
    <button type="button" class="btn pri wide" id="brGo" style="margin-top:14px">Abrir e repor</button>`);
  $('#brX').onclick = back;
  bindEye('brP', 'brP');
  const submit = async () => {
    const go = $('#brGo');
    go.disabled = true;
    go.textContent = 'A abrir…';
    try {
      finish(await openBackup(text, { password: $('#brP').value }));
    } catch (e) {
      go.disabled = false;
      go.textContent = 'Abrir e repor';
      toast(e.message, true);
    }
  };
  $('#brGo').onclick = submit;
  $('#brP').onkeydown = e => { if (e.key === 'Enter') submit(); };
}
