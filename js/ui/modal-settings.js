import { ACCENTS, BACKGROUNDS, DEFAULT_RATES } from '../config.js';
import { state, commit, save, importJSON, wipe, readUndo, restoreUndo } from '../store.js';
import { saveBackup, daysSinceBackup, isPersisted, requestPersistence } from '../backup.js';
import { fxRate, fxFresh } from '../fx.js';
import { yahooQuote, validProxyUrl } from '../quotes/stocks.js';
import { refresh } from '../quotes/index.js';
import { esc, price, num, ago } from '../format.js';
import { $, toast, openModal, closeModal, segmented } from './dom.js';
import { applyAccent } from './theme.js';

let hooks = { onBackground() {}, onSchedule() {} };
export const configureSettings = h => { hooks = { ...hooks, ...h }; };

const REFRESH_OPTS = [[0, 'Manual'], [1, '1 min'], [5, '5 min'], [15, '15 min']];

export function modalSettings() {
  const s = state.settings, c = state.cache;
  const autoUsd = c.rates?.USD || DEFAULT_RATES.USD;
  const hasProxy = !!(s.proxyUrl || '').trim();
  const undo = readUndo();
  openModal(`<div class="mh"><h3>Definições</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <div class="set-sec">🎨 Aspeto</div>
    <div class="field"><label>Fundo animado</label>
      <div class="bgrid" id="sBg">${BACKGROUNDS.map(b => `<button type="button" class="bgchip${s.bgStyle === b.id ? ' on' : ''}" data-bg="${b.id}"><span class="bgico">${b.i}</span><span>${b.n}</span></button>`).join('')}</div></div>
    <div class="field" style="margin-top:14px"><label>Cor de destaque</label>
      <div class="acrow" id="sAccent">${ACCENTS.map(a => `<button type="button" class="acchip${s.accent === a.id ? ' on' : ''}" data-ac="${a.id}" title="${a.n}" aria-label="${a.n}" style="--ac:${a.a}"><span class="acdot"></span></button>`).join('')}</div></div>

    <div class="sep"></div>
    <div class="set-sec">💱 Moeda e câmbio</div>
    <div class="set-row"><div><div class="sl">Moeda principal</div><div class="sd">Como o património é mostrado</div></div>
      <div class="seg" id="sCur"><button type="button" data-sc="EUR" class="${s.displayCurrency === 'EUR' ? 'on' : ''}">€</button><button type="button" data-sc="USD" class="${s.displayCurrency === 'USD' ? 'on' : ''}">$</button></div></div>
    <div class="field"><label for="sFx">Câmbio EUR→USD ${s.fxManual ? '<span class="sublbl">manual</span>' : '<span class="sublbl">automático · BCE</span>'}</label>
      <div class="pqrow"><input class="inp mono" id="sFx" inputmode="decimal" autocomplete="off" value="${fxRate().toFixed(4).replace('.', ',')}">
        ${s.fxManual ? '<button type="button" class="btn ghost" id="sFxAuto">Automático</button>' : ''}</div>
      <div class="sd" style="margin-top:6px">${c.fxUpdated ? `Câmbio do BCE atualizado ${ago(c.fxUpdated)} (1 € = ${autoUsd.toFixed(4).replace('.', ',')} $).` : 'Ainda sem câmbio ao vivo.'}${fxFresh() ? '' : ' Sem câmbio recente, as ações noutra moeda mostram o preço manual.'}</div></div>
    <div class="field"><label for="sFee">Taxa de conversão cambial (%)</label>
      <input class="inp mono" id="sFee" inputmode="decimal" autocomplete="off" value="${String(s.fxFeePct ?? 0).replace('.', ',')}">
      <div class="sd" style="margin-top:6px">Cobrada ao comprar/vender ações numa moeda diferente da conta. Aplica-se à <b>XTB</b> (0,5%); a <b>Trade Republic</b> e a <b>Revolut</b> ficam isentas. Põe 0 para desligar.</div></div>

    <div class="sep"></div>
    <div class="set-sec">📡 Cotações</div>
    <div class="field"><label for="sProxy">Atalho de cotações (Cloudflare Worker)</label>
      <div class="pqrow"><input class="inp mono" id="sProxy" value="${esc(s.proxyUrl || '')}" placeholder="https://o-teu-atalho.workers.dev" autocomplete="off" spellcheck="false">
        <button type="button" class="btn ghost" id="sProxyTest">Testar</button></div>
      <div class="sd" id="sProxyInfo" style="margin-top:6px">${hasProxy
        ? '<span style="color:var(--up)">● Atalho ativo</span> — as ações e ETFs leem cotações do Yahoo por aqui.'
        : 'Opcional, mas recomendado: um atalho próprio (grátis, ~3 min a criar — vê <b>worker/README.md</b> no repositório) deixa todas as ações ao vivo de forma fiável. Sem ele, a app usa intermediários públicos, que às vezes falham.'}</div></div>
    <div class="field"><label for="sKey">Chave Twelve Data <span class="sublbl">reserva, opcional</span> <a class="lnk" href="https://twelvedata.com/register" target="_blank" rel="noopener">obter →</a></label>
      <input class="inp mono" id="sKey" value="${esc(s.apiKey || '')}" placeholder="opcional — só como reserva" autocomplete="off" spellcheck="false">
      <div class="sd" style="margin-top:6px">${(s.apiKey || '').trim() ? '<span style="color:var(--up)">● Reserva ativa.</span> ' : ''}Só é usada se o Yahoo não responder para alguma ação (o plano grátis cobre sobretudo os EUA).</div></div>
    <div class="field"><label>Atualização automática das ações</label>
      <div class="mseg cur5" id="sRefresh">${REFRESH_OPTS.map(([m, l]) => `<button type="button" data-m="${m}" class="${(s.refreshMin || 0) === m ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="sd" style="margin-top:8px">A cripto atualiza a cada minuto. Toca em <b>↻</b> para forçar tudo na hora.</div></div>

    <div class="sep"></div>
    <div class="set-sec">🛟 Dados e segurança</div>
    <p class="mlead" style="margin-bottom:10px">Os teus dados ficam <b>só neste dispositivo</b> — nada é enviado para servidores. Guarda backups regularmente.</p>
    <div class="set-row"><div><div class="sl">Armazenamento</div><div class="sd" id="sPersist">A verificar…</div></div></div>
    <div class="set-row"><div><div class="sl">Cópia de segurança</div><div class="sd">${backupInfo()}</div></div></div>
    <div class="row2"><button type="button" class="btn ghost" id="sExp" style="justify-content:center">↓ Guardar backup</button>
      <button type="button" class="btn ghost" id="sImp" style="justify-content:center">↑ Importar</button></div>
    <input type="file" id="sFile" accept="application/json,.json" class="hide">
    ${undo ? `<button type="button" class="btn ghost wide" id="sUndo" style="margin-top:10px">↶ Repor os dados de antes ${undo.reason === 'wipe' ? 'de apagar tudo' : 'da importação'} <span class="sublbl">${undoWhen(undo.ts)}</span></button>` : ''}
    <div class="sep"></div>
    <button type="button" class="btn danger ghost wide" id="sWipe">Apagar tudo</button>`);

  segmented($('#sBg'), 'bg', id => { s.bgStyle = id; save(); hooks.onBackground(); });
  segmented($('#sAccent'), 'ac', id => { s.accent = applyAccent(id); commit(); });
  segmented($('#sCur'), 'sc', cur => { s.displayCurrency = cur; commit(); });

  $('#sFx').onchange = () => {
    const v = num($('#sFx').value);
    s.fxManual = v > 0 && Math.abs(v - autoUsd) > 1e-6 ? v : null;
    commit();
    modalSettings();
  };
  const fxAuto = $('#sFxAuto');
  if (fxAuto) fxAuto.onclick = () => { s.fxManual = null; commit(); modalSettings(); };

  $('#sFee').onchange = () => {
    const v = num($('#sFee').value);
    s.fxFeePct = v >= 0 && v < 20 ? v : 0;
    commit();
  };

  $('#sProxy').onchange = () => {
    const v = $('#sProxy').value.trim();
    if (v && !validProxyUrl(v)) return toast('Endereço inválido — tem de começar por https://', true);
    s.proxyUrl = v;
    c.stockMiss = {};
    commit();
    toast(v ? 'Atalho guardado — a atualizar ações' : 'Atalho removido');
    refresh({ crypto: false, force: true });
  };

  $('#sProxyTest').onclick = async () => {
    const v = $('#sProxy').value.trim();
    const info = $('#sProxyInfo');
    if (v && !validProxyUrl(v)) return toast('Endereço inválido — tem de começar por https://', true);
    const prev = s.proxyUrl;
    s.proxyUrl = v;
    info.textContent = 'A testar com a Apple (AAPL)…';
    const t0 = performance.now();
    const q = await yahooQuote('AAPL').catch(() => null);
    s.proxyUrl = prev;
    info.innerHTML = q
      ? `<span style="color:var(--up)">● A funcionar</span> — AAPL ${price(q.price, q.cur)} em ${Math.round(performance.now() - t0)} ms${v ? '' : ' (via intermediário público)'}.`
      : '<span style="color:var(--down)">● Sem resposta.</span> Confirma o endereço do atalho ou tenta mais tarde.';
  };

  $('#sKey').onchange = () => {
    s.apiKey = $('#sKey').value.trim();
    c.stockMiss = {};
    commit();
    if (s.apiKey) { toast('Chave guardada — a buscar cotações'); refresh({ crypto: false, force: true }); }
  };

  segmented($('#sRefresh'), 'm', m => {
    s.refreshMin = +m;
    save();
    hooks.onSchedule();
    toast(s.refreshMin ? `Ações: a cada ${s.refreshMin} min` : 'Ações: só manual (↻)');
  });

  $('#sExp').onclick = async () => {
    if (!(await saveBackup())) return;
    save();
    modalSettings();
    toast('Backup guardado');
  };

  $('#sImp').onclick = () => $('#sFile').click();
  $('#sFile').onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      importJSON(await f.text());
      applyAccent(state.settings.accent);
      hooks.onBackground();
      hooks.onSchedule();
      commit();
      closeModal();
      toast('Backup importado');
      refresh({ force: true });
    } catch {
      toast('Ficheiro inválido', true);
    }
  };

  const undoBtn = $('#sUndo');
  if (undoBtn) undoBtn.onclick = () => {
    if (!confirm('Repor os dados anteriores? Os dados atuais são substituídos.')) return;
    if (!restoreUndo()) return toast('Não há dados para repor', true);
    applyAccent(state.settings.accent);
    hooks.onBackground();
    hooks.onSchedule();
    commit();
    closeModal();
    toast('Dados repostos');
    refresh({ force: true });
  };

  showPersistence();

  $('#sWipe').onclick = () => {
    if (!confirm('Apagar todas as posições, histórico, fundos e alertas?\n\nPodes repor os dados em Definições → “Repor os dados de antes de apagar tudo”.')) return;
    wipe();
    commit();
    closeModal();
    toast('Tudo apagado');
  };
}

function backupInfo() {
  const d = daysSinceBackup();
  if (d == null) return 'Ainda não fizeste nenhum backup.';
  return `Último backup ${d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`}. Guarda posições, histórico, fundos, alertas e definições.`;
}

const undoWhen = ts => new Date(ts).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function showPersistence() {
  const el = $('#sPersist');
  const ok = await isPersisted();
  if (!el?.isConnected) return;
  if (ok === null) { el.textContent = 'Este browser não permite proteger o armazenamento — faz backups com frequência.'; return; }
  if (ok) { el.innerHTML = '<span style="color:var(--up)">🔒 Protegido</span> — o browser não apaga os dados sozinho.'; return; }
  el.innerHTML = '<span style="color:var(--down)">⚠ Não protegido</span> — o browser pode apagá-los se faltar espaço. <button type="button" class="lnk" id="sPersistBtn">Proteger</button>';
  $('#sPersistBtn').onclick = async () => {
    const granted = await requestPersistence();
    toast(granted ? 'Armazenamento protegido' : 'O browser recusou — instala a app e faz backups', !granted);
    showPersistence();
  };
}
