import { state, commit } from '../store.js';
import { quoteFor } from '../quotes/stocks.js';
import { refresh } from '../quotes/index.js';
import { watchQuote, addWatch, updateWatch, removeWatch, toTarget, reached, sinceAdded } from '../watchlist.js';
import { extQuote, marketOf, marketStatus, dayMoveAt, dayWord } from '../markets.js';
import { esc, price, pct, sym, num, inputNum } from '../format.js';
import { $, toast, openModal, closeModal, segmented } from './dom.js';
import { coinSearch, stockSearch } from './asset-search.js';
import { modalAdd } from './modal-position.js';

const PHASE_DOT = { open: 'open', pre: 'pre', post: 'post', closed: 'closed' };
const PHASE_TXT = { open: 'aberta', pre: 'pré-mercado', post: 'pós-mercado', closed: 'fechada' };

function icon(w) {
  return w.kind === 'crypto' && w.thumb
    ? `<img src="${esc(w.thumb)}" alt="" loading="lazy">`
    : esc((w.symbol || w.name).slice(0, 3).toUpperCase());
}

function watchRow(w) {
  const q = watchQuote(w), id = esc(w.id);
  const mk = w.kind === 'stock' ? marketOf(w.quoteSymbol) : null;
  const phase = mk ? marketStatus(mk).phase : null;
  const dist = toTarget(w, q), hit = reached(w, q), since = sinceAdded(w, q);
  const ext = w.kind === 'stock' ? extQuote(w.quoteSymbol) : null;
  const sub = [
    w.kind === 'crypto' ? 'Cripto' : `${esc(w.quoteSymbol)}${phase ? ` <span class="mk-dot ${PHASE_DOT[phase]}" title="Bolsa: ${PHASE_TXT[phase]}"></span>` : ''}`,
    since != null && `desde ${esc(w.addedAt)} <span class="${since >= 0 ? 'up' : 'down'}">${pct(since)}</span>`,
  ].filter(Boolean).join(' · ');
  const target = w.target > 0
    ? `<div class="w-target${hit ? ' hit' : ''}">🎯 ${w.above ? '▲ sobe até' : '▼ desce até'} <b class="mono">${price(w.target, q.cur || w.quoteCur || w.cur)}</b>
        ${hit ? '<span class="up">· ✓ chegou ao alvo</span>' : dist != null ? `<span class="muted">· falta ${pct(dist)}</span>` : ''}
        ${w.notify ? '<span title="Aviso ligado">🔔</span>' : ''}</div>`
    : '';
  return `<article class="pos wrow">
    <div class="pos-top">
      <div class="tkn">${icon(w)}</div>
      <div style="min-width:0"><div class="nm">${esc(w.name)}</div><div class="sub">${sub}</div></div>
      <div class="pos-r">
        <div class="pl mono">${q.price > 0 ? price(q.price, q.cur) : '—'}</div>
        ${q.dayPct != null ? `<div class="day ${q.dayPct >= 0 ? 'up' : 'down'}">${dayWord(q.at)} ${pct(q.dayPct)}</div>` : `<div class="day muted">${q.live ? '' : 'sem cotação'}</div>`}
      </div>
    </div>
    ${ext ? `<div class="extline">${ext.phase === 'pre' ? '🌅 Pré-mercado' : '🌙 Pós-mercado'} <b class="mono">${price(ext.price, q.cur)}</b> <span class="${ext.pct >= 0 ? 'up' : 'down'}">${pct(ext.pct)}</span></div>` : ''}
    ${target}
    ${w.note ? `<div class="w-note">${esc(w.note)}</div>` : ''}
    <div class="pos-act">
      <div class="acts-main"><button class="btn ghost" data-action="watch-buy" data-id="${id}">＋ Comprar</button>
        <button class="btn ghost" data-action="watch-edit" data-id="${id}">🎯 Alvo e nota</button></div>
      <div class="acts-ic"><button class="btn xic" data-action="watch-del" data-id="${id}" title="Deixar de seguir" aria-label="Deixar de seguir">✕</button></div>
    </div>
  </article>`;
}

export function viewWatch() {
  const list = state.watchlist;
  const head = `<div class="sh"><h3>A seguir</h3><div class="sh-r"><button class="btn ghost" data-action="watch-add">＋ Seguir</button></div></div>`;
  if (!list.length) {
    return `${head}<div class="empty"><div class="ei"></div><h4>Ações e cripto que ainda não tens</h4>
      <p>Acompanha o preço ao vivo e a variação do dia, e define o preço a que queres comprar — a app avisa-te quando lá chegar.</p>
      <button class="btn pri" data-action="watch-add">Seguir um ativo</button></div>`;
  }
  return `${head}<div class="plist">${list.map(watchRow).join('')}</div>`;
}

/* ---------- adicionar / editar ---------- */

function targetFields(w, cur) {
  return `<div class="field"><label>Avisar quando</label><div class="mseg" id="wDir">
      <button type="button" data-d="below" class="${w?.above ? '' : 'on'}">▼ Descer até</button>
      <button type="button" data-d="above" class="${w?.above ? 'on' : ''}">▲ Subir até</button></div></div>
    <div class="field"><label for="wTarget">Preço-alvo <span class="sublbl" id="wCur">${cur ? esc(sym(cur)) : ''} · opcional</span></label>
      <input class="inp mono" id="wTarget" inputmode="decimal" autocomplete="off" placeholder="ex: preço a que queres comprar" value="${w?.target ? inputNum(w.target) : ''}"></div>
    <label class="chk"><input type="checkbox" id="wNotify" ${w?.notify === false ? '' : 'checked'}> Avisar-me (notificação) quando chegar ao alvo</label>
    <div class="field" style="margin-top:12px"><label for="wNote">Nota <span class="sublbl">opcional</span></label>
      <textarea class="inp" id="wNote" rows="2" placeholder="Porque sigo isto? O que espero?">${esc(w?.note || '')}</textarea></div>`;
}

function readTarget() {
  const raw = $('#wTarget').value.trim(), target = raw ? num(raw) : null;
  if (raw && !(target > 0)) { toast('Preço-alvo inválido', true); return null; }
  return { target, above: $('#wDir .on')?.dataset.d === 'above', notify: $('#wNotify').checked, note: $('#wNote').value.trim().slice(0, 500) };
}

async function askNotifications(patch) {
  if (!patch.notify || !patch.target) return;
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* sem notificações */ }
}

export function modalWatchAdd() {
  const draft = { kind: 'stock', pick: null, quote: null, token: 0 };
  openModal(`<div class="mh"><h3>Seguir um ativo</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <div class="field"><div class="mseg" id="wKind"><button type="button" data-k="stock" class="on">Ação / ETF</button><button type="button" data-k="crypto">Cripto</button></div></div>
    <div id="wAsset"></div>
    <div id="wMore" hidden>${targetFields(null, '')}</div>
    <button type="button" class="btn pri wide" id="wSave" style="margin-top:14px" disabled>Seguir</button>`);

  const renderAsset = () => {
    const a = $('#wAsset');
    $('#wMore').hidden = !draft.pick;
    $('#wSave').disabled = !draft.pick;
    if (draft.pick) {
      const p = draft.pick;
      a.innerHTML = `<div class="picked">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : `<div class="tkn" style="width:30px;height:30px;font-size:11px">${esc((p.symbol || p.name).slice(0, 3).toUpperCase())}</div>`}
        <div style="min-width:0"><div class="rn">${esc(p.name)}</div><div class="rs" style="color:var(--brass-2)">${esc(p.sub)}</div></div>
        <button type="button" class="x" data-clear style="margin-left:auto" aria-label="Escolher outro">✕</button></div>
        <div class="curhint" id="wQuote">${draft.quote ? `Agora: <b>${price(draft.quote.price, draft.quote.cur)}</b>` : 'A obter cotação…'}</div>`;
      a.querySelector('[data-clear]').onclick = () => { draft.pick = null; draft.quote = null; draft.token++; renderAsset(); };
      return;
    }
    a.innerHTML = `<div class="field"><input class="inp" id="wSearch" placeholder="${draft.kind === 'crypto' ? 'Bitcoin, ETH, Solana…' : 'Apple, Nvidia, ASML, VWCE…'}" autocomplete="off" data-autofocus>
      <div class="results" id="wResults"></div></div>`;
    if (draft.kind === 'crypto') {
      coinSearch($('#wSearch'), $('#wResults'), c => {
        draft.pick = { kind: 'crypto', name: c.name, symbol: c.symbol.toUpperCase(), coingeckoId: c.id, thumb: c.thumb, cur: state.settings.displayCurrency === 'USD' ? 'USD' : 'EUR', sub: c.symbol.toUpperCase() };
        renderAsset();
        draft.quote = null;
        $('#wQuote').textContent = 'A cotação aparece na lista em menos de 1 minuto.';
        $('#wCur').textContent = `${sym(draft.pick.cur)} · opcional`;
      });
    } else {
      stockSearch($('#wSearch'), $('#wResults'), s => {
        draft.pick = { kind: 'stock', name: s.n, symbol: s.t, quoteSymbol: s.y, quoteCur: s.c || null, exchange: s.x || '', sub: `${s.t} · ${s.x || s.y}` };
        renderAsset();
        loadQuote(s.y);
      });
    }
    setTimeout(() => $('#wSearch')?.focus(), 50);
  };

  async function loadQuote(y) {
    const my = ++draft.token;
    const q = await quoteFor(y).catch(() => null);
    if (my !== draft.token || !draft.pick) return;
    draft.quote = q;
    if (q) {
      state.cache.stockPrices[y] = { ...q, ts: Date.now() };
      draft.pick.quoteCur = q.cur;
      $('#wCur').textContent = `${sym(q.cur)} · opcional`;
    }
    const el = $('#wQuote');
    if (el) el.innerHTML = q ? `Agora: <b>${price(q.price, q.cur)}</b>${q.dayPct != null ? ` · ${dayWord(dayMoveAt(y))} ${pct(q.dayPct)}` : ''}` : 'Sem cotação agora — aparece quando o Yahoo responder.';
  }

  segmented($('#wKind'), 'k', k => { draft.kind = k; draft.pick = null; draft.quote = null; draft.token++; renderAsset(); });
  segmented($('#wDir'), 'd', () => {});
  renderAsset();

  $('#wSave').onclick = async () => {
    if (!draft.pick) return toast('Escolhe o ativo', true);
    const patch = readTarget();
    if (!patch) return;
    const item = { ...draft.pick };
    delete item.sub;
    const w = addWatch({ ...item, ...patch }, draft.quote);
    await askNotifications(patch);
    commit();
    closeModal();
    toast(`A seguir ${w.name}`);
    if (!draft.quote) refresh({ crypto: w.kind === 'crypto', stocks: w.kind === 'stock', force: true });
  };
}

export function modalWatchEdit(id) {
  const w = state.watchlist.find(x => x.id === id);
  if (!w) return;
  const q = watchQuote(w);
  openModal(`<div class="mh"><h3>${esc(w.name)}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <p class="mlead">Agora: <b>${q.price > 0 ? price(q.price, q.cur) : '—'}</b>${q.dayPct != null ? ` · ${dayWord(q.at)} ${pct(q.dayPct)}` : ''}${w.fired ? ' · <span class="up">o aviso já disparou — guarda para o voltar a ligar</span>' : ''}</p>
    ${targetFields(w, q.cur || w.quoteCur || w.cur)}
    <button type="button" class="btn pri wide" id="wSave" style="margin-top:14px">Guardar</button>`);
  segmented($('#wDir'), 'd', () => {});
  $('#wSave').onclick = async () => {
    const patch = readTarget();
    if (!patch) return;
    updateWatch(id, { ...patch, fired: false });
    await askNotifications(patch);
    commit();
    closeModal();
    toast('Guardado');
  };
}

export function watchBuy(id) {
  const w = state.watchlist.find(x => x.id === id);
  if (!w) return;
  modalAdd(w.kind === 'crypto'
    ? { kind: 'crypto', currency: w.cur, coin: { id: w.coingeckoId, name: w.name, symbol: w.symbol, thumb: w.thumb }, watchId: w.id }
    : { kind: 'stock', stock: { n: w.name, t: w.symbol, x: w.exchange || '', c: w.quoteCur, y: w.quoteSymbol }, watchId: w.id });
}

export function watchDelete(id) {
  const w = removeWatch(id);
  if (!w) return;
  commit();
  toast(`Deixaste de seguir ${w.name}`);
}
