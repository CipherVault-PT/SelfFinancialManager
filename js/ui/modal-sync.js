import { state, commit, hasData } from '../store.js';
import {
  sync, syncConfig, syncEnabled, checkWorker, connect, finishConnect, syncNow, disconnect, deleteCloud, resolveConflict, run, userPart,
} from '../sync/engine.js';
import { esc, ago, plural } from '../format.js';
import { $, toast, openModal, closeModal } from './dom.js';

const STATUS = {
  ok: ['up', 'Sincronizado'], busy: ['', 'A sincronizar…'], offline: ['warn', 'Sem ligação — sincroniza quando voltar a internet'],
  auth: ['down', 'Frase-passe inválida'], error: ['down', 'Erro'], setup: ['down', 'Falta configurar'], conflict: ['warn', 'Conflito por resolver'], off: ['', 'Desligado'],
};

const host = url => { try { return new URL(url).host; } catch { return url; } };

/** Texto curto para a barra de estado do topo. */
export function syncBadge() {
  if (!syncEnabled()) return '';
  return { ok: '☁', busy: '☁…', offline: '☁ offline', conflict: '☁ conflito', auth: '☁ erro', error: '☁ erro', setup: '☁ erro' }[sync.status] ?? '☁';
}

/* ---------- secção nas Definições ---------- */

export function syncSection() {
  const cfg = syncConfig();
  const [cls, label] = STATUS[sync.status] ?? STATUS.off;
  return `<div class="sep"></div>
    <div class="set-sec" id="syncSec">☁️ Sincronização</div>
    ${cfg ? `
      <div class="set-row"><div><div class="sl">Estado</div>
        <div class="sd" id="syncState"><span class="${cls === 'up' ? '' : cls}" style="${cls === 'up' ? 'color:var(--up)' : ''}">● ${label}</span>${cfg.at ? ` · ${ago(cfg.at)}` : ''}${sync.error && sync.status !== 'ok' ? `<br>${esc(sync.error)}` : ''}</div></div></div>
      <div class="set-row"><div><div class="sl">Worker</div><div class="sd mono">${esc(host(cfg.url))}</div></div></div>
      <div class="row2"><button type="button" class="btn ghost" id="syNow" style="justify-content:center">↻ Sincronizar agora</button>
        <button type="button" class="btn ghost" id="syOff" style="justify-content:center">Desligar aqui</button></div>
      ${sync.status === 'auth' ? '<button type="button" class="btn pri wide" id="syRelink" style="margin-top:10px">Voltar a ligar</button>' : ''}
      ${sync.conflict ? '<button type="button" class="btn pri wide" id="syConflict" style="margin-top:10px">Resolver o conflito</button>' : ''}
      <button type="button" class="lnk" id="syDel" style="margin-top:12px;font-size:12.5px;color:var(--down)">Apagar a cópia na nuvem</button>`
    : `<p class="mlead" style="margin-bottom:10px">Os mesmos dados no telemóvel e no computador, automaticamente. Usa o teu <b>Worker da Cloudflare</b> (grátis) — o mesmo das cotações — e os dados vão <b>cifrados com a tua frase-passe</b>: nem a Cloudflare os consegue ler.</p>
      <div class="row2"><button type="button" class="btn ghost" id="syGuide" style="justify-content:center">📘 Como criar (5 min)</button>
        <button type="button" class="btn pri" id="sySetup" style="justify-content:center">Ligar</button></div>`}`;
}

export function bindSyncSection(back) {
  $('#syGuide')?.addEventListener('click', () => modalSyncGuide(back));
  $('#sySetup')?.addEventListener('click', () => modalSyncSetup(back));
  $('#syRelink')?.addEventListener('click', () => modalSyncSetup(back));
  $('#syConflict')?.addEventListener('click', showConflict);
  $('#syNow')?.addEventListener('click', async () => {
    $('#syNow').disabled = true;
    await syncNow();
    toast(sync.status === 'ok' ? 'Sincronizado' : sync.error || 'Não foi possível sincronizar', sync.status !== 'ok');
    if (sync.status === 'conflict') return showConflict();
    back();
  });
  $('#syOff')?.addEventListener('click', () => {
    if (!confirm('Desligar a sincronização neste dispositivo?\n\nOs dados ficam aqui e na nuvem; só deixam de se atualizar entre si.')) return;
    disconnect();
    toast('Sincronização desligada neste dispositivo');
    back();
  });
  $('#syDel')?.addEventListener('click', async () => {
    if (!confirm('Apagar a cópia cifrada guardada na nuvem?\n\nOs dados de cada dispositivo ficam onde estão. Para voltar a sincronizar terás de ligar outra vez (com uma frase-passe nova, se quiseres).')) return;
    try {
      await deleteCloud();
      toast('Cópia na nuvem apagada');
    } catch (e) {
      toast(e.message, true);
    }
    back();
  });
}

/* ---------- guia da Cloudflare ---------- */

export const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/CipherVault-PT/SelfFinancialManager/tree/main/worker';

export function modalSyncGuide(back = closeModal) {
  const step = (n, html) => `<div class="guide-step"><span class="guide-n">${n}</span><div>${html}</div></div>`;
  openModal(`<div class="mh"><h3>Criar o teu Worker</h3><button type="button" class="x" id="sgBack" aria-label="Voltar">✕</button></div>
    <p class="mlead">Uma vez só, e grátis: o plano gratuito chega e sobra. Funciona bem no telemóvel — não é preciso copiar código.</p>
    <a class="btn pri wide" id="sgDeploy" href="${DEPLOY_URL}" target="_blank" rel="noopener" style="margin-bottom:12px">🚀 Criar o Worker na Cloudflare</a>
    <div class="guide">
      ${step(1, 'Entra na Cloudflare (ou cria conta grátis) e, quando pedir, <b>liga o GitHub</b>: a Cloudflare guarda lá uma cópia do código e instala-o daí.')}
      ${step(2, 'Deixa o nome <code>aurora</code> e carrega em <b>Create and deploy</b>. O cofre (KV) é criado sozinho. Espera ~1 minuto.')}
      ${step(3, 'Copia o endereço do Worker (ex: <code>https://aurora.o-teu-nome.workers.dev</code>).')}
      ${step(4, 'Aqui na app: <b>Ligar</b> → cola o endereço e escolhe uma frase-passe. Nos outros dispositivos, o <b>mesmo endereço</b> e a <b>mesma frase-passe</b>.')}
    </div>
    <details class="guide-alt">
      <summary>Sem GitHub: à mão, no computador</summary>
      <div class="guide">
        ${step(1, 'Em <a class="lnk" href="https://dash.cloudflare.com" target="_blank" rel="noopener">dash.cloudflare.com</a>: <b>Storage &amp; Databases → KV</b> → <b>Create</b> → nome <code>aurora-sync</code>.')}
        ${step(2, '<b>Workers &amp; Pages → Create → Create Worker</b> → nome <code>aurora</code> → <b>Deploy</b>.')}
        ${step(3, `<b>Edit code</b>, apaga o que lá está e cola o código da Aurora → <b>Deploy</b>.<br>
          <button type="button" class="btn ghost sm" id="sgCopy" style="margin-top:8px">📋 Copiar o código do Worker</button>`)}
        ${step(4, 'No Worker: <b>Settings → Bindings → Add → KV namespace</b>. Nome da variável: <code>SYNC</code> · namespace: <code>aurora-sync</code> → <b>Deploy</b>.')}
      </div>
      <textarea class="inp mono guide-code" id="sgCode" readonly hidden></textarea>
    </details>
    <div class="curhint">Ao ligar, as cotações passam também a usar este Worker.</div>
    <button type="button" class="btn ghost wide" id="sgNext" style="margin-top:14px">Já está — ligar</button>`);
  $('#sgBack').onclick = back;
  $('#sgNext').onclick = () => modalSyncSetup(back);
  $('#sgCopy').onclick = async () => {
    try {
      const res = await fetch('./worker/aurora-worker.js', { cache: 'no-cache' });
      if (!res.ok) throw new Error();
      const code = await res.text();
      try {
        await navigator.clipboard.writeText(code);
        toast('Código copiado — cola-o no Worker');
      } catch {
        const ta = $('#sgCode');
        ta.hidden = false;
        ta.value = code;
        ta.select();
        toast('Seleciona e copia o código abaixo');
      }
    } catch {
      toast('Não consegui obter o código — está em worker/aurora-worker.js no GitHub', true);
    }
  };
}

/* ---------- ligar ---------- */

const counts = d => {
  const parts = [plural(d.positions?.length || 0, 'posição', 'posições'), plural(d.closed?.length || 0, 'venda', 'vendas')];
  if (d.cash?.length) parts.push(plural(d.cash.length, 'fundo', 'fundos'));
  return parts.join(' · ');
};

export function modalSyncSetup(back = closeModal) {
  const cfg = syncConfig();
  let checked = null;
  openModal(`<div class="mh"><h3>Ligar a sincronização</h3><button type="button" class="x" id="ssBack" aria-label="Voltar">✕</button></div>
    <p class="mlead">No primeiro dispositivo crias o cofre; nos outros usas o <b>mesmo endereço</b> e a <b>mesma frase-passe</b>.</p>
    <div class="field"><label for="ssUrl">Endereço do Worker</label>
      <div class="pqrow"><input class="inp mono" id="ssUrl" value="${esc(cfg?.url || state.settings.proxyUrl || '')}" placeholder="https://aurora.o-teu-nome.workers.dev" autocomplete="off" spellcheck="false" data-autofocus>
        <button type="button" class="btn ghost" id="ssCheck">Verificar</button></div>
      <div class="sd" id="ssInfo" style="margin-top:6px">Ainda não tens? <button type="button" class="lnk" id="ssGuide">Vê como criar (5 min)</button></div></div>
    <div id="ssPass" hidden>
      <div class="field"><label for="ssP1">Frase-passe</label>
        <div class="pqrow"><input class="inp" id="ssP1" type="password" autocomplete="new-password" placeholder="ex: quatro palavras que só tu sabes">
          <button type="button" class="btn ghost" id="ssEye" aria-label="Mostrar">👁</button></div></div>
      <div class="field" id="ssRep" hidden><label for="ssP2">Repetir a frase-passe</label><input class="inp" id="ssP2" type="password" autocomplete="new-password"></div>
      <div class="curhint" id="ssHint"></div>
      <button type="button" class="btn pri wide" id="ssGo" style="margin-top:12px">Ligar</button>
    </div>`);
  $('#ssBack').onclick = back;
  $('#ssGuide').onclick = () => modalSyncGuide(back);
  $('#ssEye').onclick = () => { for (const i of [$('#ssP1'), $('#ssP2')]) i.type = i.type === 'password' ? 'text' : 'password'; };

  const verify = async () => {
    const info = $('#ssInfo');
    info.textContent = 'A verificar…';
    try {
      checked = await checkWorker($('#ssUrl').value);
    } catch (e) {
      checked = null;
      $('#ssPass').hidden = true;
      info.innerHTML = `<span style="color:var(--down)">● ${esc(e.message)}</span> <button type="button" class="lnk" id="ssGuide2">Ver o guia</button>`;
      $('#ssGuide2').onclick = () => modalSyncGuide(back);
      return;
    }
    if (!checked.sync) {
      $('#ssPass').hidden = true;
      info.innerHTML = '<span style="color:var(--up)">● Worker OK</span> · cotações ✓ · <span style="color:var(--down)">falta ligar o cofre (passo 5 do guia: KV com o nome <b>SYNC</b>)</span>';
      return;
    }
    info.innerHTML = `<span style="color:var(--up)">● Worker OK</span> · cotações ✓ · cofre ${checked.vault ? '<b>já existe</b> — usa a frase-passe que escolheste no primeiro dispositivo' : '<b>novo</b> — vai ser criado agora'}`;
    $('#ssPass').hidden = false;
    $('#ssRep').hidden = checked.vault;
    $('#ssHint').innerHTML = checked.vault
      ? ''
      : 'Pelo menos 10 caracteres — o ideal são 4 ou mais palavras. <b>Se a esqueceres, a cópia na nuvem não se recupera</b>: guarda-a num gestor de passwords.';
    $('#ssP1').focus();
  };
  $('#ssCheck').onclick = verify;
  $('#ssUrl').onchange = verify;
  if ($('#ssUrl').value) verify();

  $('#ssGo').onclick = async () => {
    if (!checked) return verify();
    const p1 = $('#ssP1').value;
    if (!checked.vault) {
      if (p1.length < 10) return toast('A frase-passe tem de ter pelo menos 10 caracteres', true);
      if (p1 !== $('#ssP2').value) return toast('As duas frases-passe não são iguais', true);
    } else if (!p1) return toast('Escreve a frase-passe', true);
    const go = $('#ssGo');
    go.disabled = true;
    go.textContent = 'A ligar… (pode demorar uns segundos)';
    let conn;
    try {
      conn = await connect(checked.url, p1);
    } catch (e) {
      go.disabled = false;
      go.textContent = 'Ligar';
      return toast(e.message, true);
    }
    if (state.settings.proxyUrl !== conn.cfg.url) { state.settings.proxyUrl = conn.cfg.url; commit(); }
    const remote = conn.remote;
    if (remote && hasData() && userPart(remote.data) !== userPart(state)) return chooseData(conn, back);
    await run(() => finishConnect(conn, remote ? 'remote' : 'local'));
    toast(sync.status === 'ok' ? (remote ? 'Sincronização ligada — dados da nuvem carregados' : 'Sincronização ligada') : sync.error, sync.status !== 'ok');
    back();
  };
}

/** Primeira ligação de um dispositivo que já tinha dados: qual versão fica. */
function chooseData(conn, back) {
  openModal(`<div class="mh"><h3>Já há dados na nuvem</h3></div>
    <p class="mlead">Este dispositivo e a nuvem têm dados diferentes. Qual queres usar? A outra versão fica guardada em ⚙ → <b>Repor os dados de antes</b>.</p>
    <div class="sync-opt"><b>☁️ Nuvem</b><span>${esc(counts(conn.remote.data))}${conn.remote.ts ? ` · guardado ${esc(ago(conn.remote.ts))}` : ''}</span></div>
    <div class="sync-opt"><b>📱 Este dispositivo</b><span>${esc(counts(state))}</span></div>
    <div class="row2" style="margin-top:14px"><button type="button" class="btn ghost" id="scLocal" style="justify-content:center">Enviar os deste</button>
      <button type="button" class="btn pri" id="scRemote" style="justify-content:center">Usar os da nuvem</button></div>`);
  const pick = async choice => {
    await run(() => finishConnect(conn, choice));
    toast(sync.status === 'ok' ? 'Sincronização ligada' : sync.error, sync.status !== 'ok');
    back();
  };
  $('#scRemote').onclick = () => pick('remote');
  $('#scLocal').onclick = () => {
    if (!confirm('Substituir os dados da nuvem pelos deste dispositivo? Os outros dispositivos vão recebê-los.')) return;
    pick('local');
  };
}

/* ---------- conflitos ---------- */

export function showConflict() {
  const remote = sync.conflict;
  if (!remote) return;
  openModal(`<div class="mh"><h3>Alterações nos dois lados</h3></div>
    <p class="mlead">Mudaste dados aqui e noutro dispositivo ao mesmo tempo. Qual versão queres manter?</p>
    <div class="sync-opt"><b>☁️ Outro dispositivo</b><span>${esc(counts(remote.data))}${remote.ts ? ` · guardado ${esc(ago(remote.ts))}` : ''}</span></div>
    <div class="sync-opt"><b>📱 Este dispositivo</b><span>${esc(counts(state))}</span></div>
    <div class="curhint">Se escolheres a do outro dispositivo, a deste fica em ⚙ → <b>Repor os dados de antes</b>.</div>
    <div class="row2" style="margin-top:14px"><button type="button" class="btn ghost" id="cfLocal" style="justify-content:center">Manter a deste</button>
      <button type="button" class="btn pri" id="cfRemote" style="justify-content:center">Usar a do outro</button></div>`);
  const pick = async choice => {
    closeModal();
    await run(() => resolveConflict(choice));
    toast(sync.status === 'ok' ? 'Dados sincronizados' : sync.error, sync.status !== 'ok');
  };
  $('#cfRemote').onclick = () => pick('remote');
  $('#cfLocal').onclick = () => pick('local');
}
