import { lockConfig, lockEnabled, checkPin, checkBio, waitMs, failsLeft, forgetEverything } from '../lock.js';
import { closeModal, modalOpen } from './dom.js';

const BEHIND = ['header', 'main', '#ov', '#toast'];
const GEM = (document.querySelector('.brand .gem')?.innerHTML ?? '').replace(/(id="|url\(#)h([gr])/g, '$1l$2');

let locked = false, waiting = false, hiddenAt = 0, entry = '', busy = false, el = null, onUnlock = () => {};

export const isLocked = () => locked;

function setBehind(on) {
  for (const s of BEHIND) document.querySelector(s)?.toggleAttribute('inert', on);
  document.body.classList.toggle('locked', on);
}

export function lockNow() {
  if (locked || !lockEnabled()) return;
  locked = true;
  entry = '';
  if (modalOpen()) closeModal();
  setBehind(true);
  el = document.createElement('div');
  el.className = 'lock';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'App bloqueada');
  const bio = !!lockConfig()?.cred;
  el.innerHTML = `<div class="lock-in">
    <span class="gem lock-gem" aria-hidden="true">${GEM}</span>
    <h2>Aurora</h2>
    <p class="lock-msg" id="lkMsg" aria-live="polite">Introduz o PIN</p>
    <div class="lock-dots" id="lkDots" aria-hidden="true"></div>
    <div class="lock-pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
      ${bio ? '<button type="button" data-k="bio" class="lock-fn" aria-label="Usar impressão digital ou Face ID">👆</button>' : '<span></span>'}
      <button type="button" data-k="0">0</button>
      <button type="button" data-k="del" class="lock-fn" aria-label="Apagar">⌫</button>
    </div>
    <button type="button" class="lnk lock-forgot" data-k="forgot">Esqueci-me do PIN</button>
  </div>`;
  document.body.append(el);
  el.addEventListener('click', e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k) press(k);
  });
  dots();
  tick();
  if (bio && document.visibilityState === 'visible') setTimeout(() => locked && press('bio'), 300);
}

function unlock() {
  locked = false;
  el?.remove();
  el = null;
  setBehind(false);
  onUnlock();
}

function dots(state = '') {
  const len = lockConfig()?.len || 4;
  const d = el?.querySelector('#lkDots');
  if (!d) return;
  d.className = `lock-dots ${state}`;
  d.innerHTML = Array.from({ length: len }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join('');
}

function msg(text, bad = false) {
  const m = el?.querySelector('#lkMsg');
  if (m) { m.textContent = text; m.classList.toggle('bad', bad); }
}

/** Mostra a contagem decrescente enquanto as tentativas estão bloqueadas. */
function tick() {
  if (!locked || !el) return;
  const ms = waitMs();
  el.classList.toggle('wait', ms > 0);
  if (ms > 0) {
    msg(`Demasiadas tentativas — espera ${Math.ceil(ms / 1000)} s`, true);
    setTimeout(tick, 1000);
  } else if (waiting) {
    msg('Introduz o PIN');
  }
  waiting = ms > 0;
}

async function press(k) {
  if (!locked || busy) return;
  if (k === 'bio') {
    busy = true;
    const ok = await checkBio();
    busy = false;
    if (ok) unlock();
    return;
  }
  if (k === 'forgot') return forgot();
  if (waitMs() > 0) return tick();
  const len = lockConfig()?.len || 4;
  if (k === 'del') entry = entry.slice(0, -1);
  else if (/^\d$/.test(k) && entry.length < len) entry += k;
  dots();
  if (entry.length < len) return;
  busy = true;
  const ok = await checkPin(entry);
  busy = false;
  if (ok) return unlock();
  entry = '';
  dots('shake');
  const left = failsLeft();
  if (waitMs() > 0) tick();
  else msg(`PIN errado${left < 5 ? ` · ${left} ${left === 1 ? 'tentativa' : 'tentativas'} antes de esperar` : ''}`, true);
}

function forgot() {
  if (!confirm('Sem o PIN, a única forma de entrar é apagar os dados guardados neste dispositivo.\n\nDepois podes repor um backup (⚙ → Repor backup). Continuar?')) return;
  if (!confirm('Tens a certeza? Isto apaga as posições, o histórico e o bloqueio deste dispositivo.')) return;
  forgetEverything();
  location.reload();
}

/** Bloqueia ao abrir e ao voltar à app depois do tempo escolhido. */
export function initLock(hooks = {}) {
  onUnlock = hooks.onUnlock ?? onUnlock;
  document.addEventListener('visibilitychange', () => {
    const c = lockConfig();
    if (!c) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      if (!c.after) lockNow();
    } else if (hiddenAt && Date.now() - hiddenAt >= c.after * 60_000) {
      lockNow();
    }
  });
  document.addEventListener('keydown', e => {
    if (!locked) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else return;
    e.preventDefault();
  });
  if (lockEnabled()) lockNow();
}
